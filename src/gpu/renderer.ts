/**
 * Viewer: imagen float -> (pila de LUTs en float32) -> transformación de display -> pantalla.
 *
 * Todo el procesamiento ocurre en texturas RGBA32F a la resolución del viewport.
 * La transformación de display es solo para mostrar: nunca toca los valores del LUT.
 */
import type { Interpolation, Lut } from '../color/lut'
import type { FloatImage } from '../io/image'
import type { Lut3D } from '../color/lut'
import type { Prepared } from '../color/pipeline'
import { Baker } from './baker'
import { createGL, createTarget, createTexture, disposeTarget, drawTo, Program, readTarget, type GL, type Target } from './gl'
import { LutCache, type GpuLut } from './lutCache'
import { LUT_GLSL } from './lutGlsl'

export type { GpuLut } from './lutCache'

export type DisplayTransform = 'none' | 'rec709-srgb' | 'rec709-p3'
export type CompareMode = 'off' | 'split' | 'before'

export interface RenderLayer {
  lut: Lut | GpuLut
  opacity: number
}

export interface View {
  /** centro de la vista en píxeles de imagen */
  cx: number
  cy: number
  /** píxeles de pantalla (físicos) por píxel de imagen */
  scale: number
}

const isGpuLut = (l: Lut | GpuLut): l is GpuLut => 'tex' in l

const RESAMPLE_FS = `#version 300 es
precision highp float;
uniform sampler2D uImg;
uniform vec2 uImgSize;
uniform vec2 uViewport;
uniform vec2 uCenter;
uniform float uScale;
out vec4 o;
void main() {
  vec2 s = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);
  vec2 p = (s - uViewport * 0.5) / uScale + uCenter;
  if (p.x < 0.0 || p.y < 0.0 || p.x >= uImgSize.x || p.y >= uImgSize.y) { o = vec4(0.0); return; }
  vec3 c = uScale >= 1.0 ? texelFetch(uImg, ivec2(p), 0).rgb : texture(uImg, p / uImgSize).rgb;
  o = vec4(c, 1.0);
}`

const LUT_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform sampler2D uLut;
uniform int uSize;
uniform int uKind;
uniform int uInterp;
uniform float uOpacity;
uniform vec3 uDomMin;
uniform vec3 uDomMax;
out vec4 o;
${LUT_GLSL}
void main() {
  vec4 s = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  vec3 c = applyLut(uLut, uSize, uKind, uInterp, uDomMin, uDomMax, s.rgb);
  o = vec4(mix(s.rgb, c, uOpacity), s.a);
}`

export const DISPLAY_GLSL = `
vec3 srgbEncode(vec3 l) {
  l = clamp(l, 0.0, 1.0);
  return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), l));
}
// mode: 0 = valores directos, 1 = Rec.709 gamma 2.4 -> sRGB, 2 = Rec.709 gamma 2.4 -> Display P3
vec3 displayTransform(vec3 v, int mode) {
  if (mode == 0) return v;
  vec3 lin = pow(max(v, 0.0), vec3(2.4));
  if (mode == 2) {
    lin = mat3(0.822462, 0.033194, 0.017083,
               0.177538, 0.966806, 0.072397,
               0.000000, 0.000000, 0.910520) * lin;
  }
  return srgbEncode(lin);
}
`

const DISPLAY_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform int uCompare; // 0 off, 1 split, 2 before
uniform float uSplit;
uniform float uLine;
uniform int uDisplay;
uniform vec3 uBackground;
out vec4 o;
${DISPLAY_GLSL}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  bool before = uCompare == 2 || (uCompare == 1 && gl_FragCoord.x < uSplit);
  vec4 s = before ? texelFetch(uBefore, p, 0) : texelFetch(uAfter, p, 0);
  vec3 c = s.a > 0.5 ? displayTransform(s.rgb, uDisplay) : uBackground;
  if (uCompare == 1 && abs(gl_FragCoord.x - uSplit) < uLine) c = vec3(0.85);
  o = vec4(c, 1.0);
}`

export class Renderer {
  readonly g: GL
  readonly canvas: HTMLCanvasElement
  private resample: Program
  private lutProg: Program
  private displayProg: Program
  private imgTex: WebGLTexture | null = null
  private imgW = 0
  private imgH = 0
  private before: Target | null = null
  private ping: Target | null = null
  private pong: Target | null = null
  private lutCache: LutCache
  private baker: Baker
  private layers: RenderLayer[] = []
  private p3Canvas = false
  /** última textura procesada (para scopes) */
  processed: Target | null = null

  view: View = { cx: 0, cy: 0, scale: 1 }
  interpolation: Interpolation = 'tetrahedral'
  display: DisplayTransform = 'rec709-srgb'
  compare: CompareMode = 'off'
  /** posición de la cortina, 0..1 del ancho */
  split = 0.5

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.g = createGL(canvas)
    const { gl } = this.g
    this.resample = new Program(gl, RESAMPLE_FS)
    this.lutProg = new Program(gl, LUT_FS)
    this.displayProg = new Program(gl, DISPLAY_FS)
    this.lutCache = new LutCache(this.g)
    this.baker = new Baker(this.g)
  }

  get gl(): WebGL2RenderingContext {
    return this.g.gl
  }

  setImage(img: FloatImage | null): void {
    const { gl, caps } = this.g
    if (this.imgTex) gl.deleteTexture(this.imgTex)
    this.imgTex = null
    this.imgW = this.imgH = 0
    if (!img) return
    if (img.width > caps.maxTextureSize || img.height > caps.maxTextureSize)
      throw new Error(
        `La imagen (${img.width}x${img.height}) excede el tamaño máximo de textura de esta GPU (${caps.maxTextureSize}).`,
      )
    const mip = caps.floatLinear && img.width * img.height <= 40_000_000
    this.imgTex = createTexture(gl, img.width, img.height, 'rgba32f', img.data, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST)
    if (mip) gl.generateMipmap(gl.TEXTURE_2D)
    this.imgW = img.width
    this.imgH = img.height
  }

  /** Define la pila de LUTs. Las texturas de LUTs que ya no se usan se liberan. */
  setLayers(layers: RenderLayer[]): void {
    const used: Lut[] = []
    for (const l of layers) if (!isGpuLut(l.lut)) used.push(l.lut)
    this.lutCache.retain(used)
    for (const lut of used) this.lutCache.get(lut)
    this.layers = layers
  }

  /** Hornea el pipeline en GPU. El resultado se puede usar como capa en setLayers. */
  bake(p: Prepared, size: number): GpuLut {
    return this.baker.bake(p, size)
  }

  /** LUT horneado leído de la GPU (lo que se exporta). */
  readBaked(): Lut3D {
    return this.baker.read()
  }

  /** Lee la imagen procesada a resolución de viewport (RGBA float, fila 0 abajo). */
  readProcessed(): { width: number; height: number; data: Float32Array } | null {
    const t = this.processed
    return t ? { width: t.width, height: t.height, data: readTarget(this.gl, t) } : null
  }

  /** Ajusta el tamaño del canvas al tamaño CSS x devicePixelRatio. Devuelve true si cambió. */
  resize(): boolean {
    const c = this.canvas
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(c.clientWidth * dpr))
    const h = Math.max(1, Math.round(c.clientHeight * dpr))
    if (c.width === w && c.height === h && this.before) return false
    c.width = w
    c.height = h
    const { gl } = this.g
    disposeTarget(gl, this.before)
    disposeTarget(gl, this.ping)
    disposeTarget(gl, this.pong)
    this.before = createTarget(gl, w, h)
    this.ping = createTarget(gl, w, h)
    this.pong = createTarget(gl, w, h)
    return true
  }

  fit(margin = 0.94): void {
    if (!this.imgW) return
    const c = this.canvas
    this.view = {
      cx: this.imgW / 2,
      cy: this.imgH / 2,
      scale: Math.min(c.width / this.imgW, c.height / this.imgH) * margin,
    }
  }

  /** Convierte coordenadas CSS relativas al canvas a píxel de imagen (puede caer fuera). */
  screenToImage(xCss: number, yCss: number): [number, number] {
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth)
    const { cx, cy, scale } = this.view
    return [(xCss * dpr - this.canvas.width / 2) / scale + cx, (yCss * dpr - this.canvas.height / 2) / scale + cy]
  }

  private applyCanvasColorSpace(): void {
    const wantP3 = this.display === 'rec709-p3'
    if (wantP3 === this.p3Canvas) return
    try {
      ;(this.gl as unknown as { drawingBufferColorSpace: string }).drawingBufferColorSpace = wantP3 ? 'display-p3' : 'srgb'
      this.p3Canvas = wantP3
    } catch {
      /* navegador sin soporte: queda en sRGB */
    }
  }

  render(): void {
    const { gl } = this.g
    this.resize()
    this.applyCanvasColorSpace()
    const W = this.canvas.width
    const H = this.canvas.height
    const before = this.before!

    if (!this.imgTex) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, before.fbo)
      gl.viewport(0, 0, W, H)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    } else {
      this.resample
        .use()
        .tex('uImg', 0, this.imgTex)
        .v2('uImgSize', this.imgW, this.imgH)
        .v2('uViewport', W, H)
        .v2('uCenter', this.view.cx, this.view.cy)
        .f('uScale', this.view.scale)
      drawTo(gl, before)
    }

    let src = before
    if (this.imgTex && this.compare !== 'before') {
      const interp = this.interpolation === 'trilinear' ? 0 : 1
      for (const layer of this.layers) {
        const lut = isGpuLut(layer.lut) ? layer.lut : this.lutCache.get(layer.lut)
        const dst = src === this.ping ? this.pong! : this.ping!
        this.lutProg
          .use()
          .tex('uSrc', 0, src.tex)
          .tex('uLut', 1, lut.tex)
          .i('uSize', lut.size)
          .i('uKind', lut.kind === '3D' ? 0 : 1)
          .i('uInterp', interp)
          .f('uOpacity', layer.opacity)
          .v3('uDomMin', lut.domainMin)
          .v3('uDomMax', lut.domainMax)
        drawTo(gl, dst)
        src = dst
      }
    }
    this.processed = src

    this.displayProg
      .use()
      .tex('uBefore', 0, before.tex)
      .tex('uAfter', 1, src.tex)
      .i('uCompare', this.compare === 'off' ? 0 : this.compare === 'split' ? 1 : 2)
      .f('uSplit', this.split * W)
      .f('uLine', Math.max(1, W / Math.max(1, this.canvas.clientWidth)) * 0.75)
      .i('uDisplay', this.display === 'none' ? 0 : this.display === 'rec709-srgb' ? 1 : 2)
      .v3('uBackground', [0.11, 0.11, 0.11])
    drawTo(gl, null, W, H)
  }

  dispose(): void {
    const { gl } = this.g
    if (this.imgTex) gl.deleteTexture(this.imgTex)
    this.lutCache.dispose()
    this.baker.dispose()
    disposeTarget(gl, this.before)
    disposeTarget(gl, this.ping)
    disposeTarget(gl, this.pong)
    this.resample.dispose()
    this.lutProg.dispose()
    this.displayProg.dispose()
  }
}
