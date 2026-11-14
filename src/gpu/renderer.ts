/**
 * Viewer: imagen float -> (pila de LUTs en float32) -> transformación de display -> pantalla.
 *
 * Todo el procesamiento ocurre en texturas RGBA32F. El preview se procesa a la resolución del viewport;
 * los scopes usan una versión de la imagen completa (no dependen del zoom ni del paneo).
 * La transformación de display es solo para mostrar: nunca toca los valores del LUT.
 *
 * Varios frames: cada uno tiene una versión reducida en GPU (float32, hasta SCOPE_SOURCE_MAX de ancho) que se
 * genera una sola vez al cargarlo. Solo el frame principal se sube a resolución completa. La grilla aplica la
 * misma pila de LUTs (un único LUT horneado) a las versiones reducidas de todos los frames.
 */
import type { Interpolation, Lut, Lut3D } from '../color/lut'
import type { Prepared } from '../color/pipeline'
import type { FloatImage } from '../io/image'
import { Baker } from './baker'
import { createGL, createTarget, createTexture, disposeTarget, drawTo, Program, readTarget, type GL, type Target } from './gl'
import { LutCache, type GpuLut } from './lutCache'
import { LUT_GLSL } from './lutGlsl'
import { Scopes, type ScopeImage, type ScopeMode } from './scopes'

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
  /** píxeles de destino por píxel de imagen */
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
uniform ivec2 uOffset; // esquina del área de dibujo (celdas de la grilla)
out vec4 o;
${DISPLAY_GLSL}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) - uOffset;
  float x = gl_FragCoord.x - float(uOffset.x);
  bool before = uCompare == 2 || (uCompare == 1 && x < uSplit);
  vec4 s = before ? texelFetch(uBefore, p, 0) : texelFetch(uAfter, p, 0);
  vec3 c = s.a > 0.5 ? displayTransform(s.rgb, uDisplay) : uBackground;
  if (uCompare == 1 && abs(x - uSplit) < uLine) c = vec3(0.85);
  o = vec4(c, 1.0);
}`

/** Tres texturas float del mismo tamaño: la imagen remuestreada y dos para ir aplicando LUTs. */
class Chain {
  before: Target | null = null
  ping: Target | null = null
  pong: Target | null = null
  width = 0
  height = 0
  private gl: WebGL2RenderingContext

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
  }

  ensure(w: number, h: number): boolean {
    if (this.before && w === this.width && h === this.height) return false
    this.dispose()
    this.before = createTarget(this.gl, w, h)
    this.ping = createTarget(this.gl, w, h)
    this.pong = createTarget(this.gl, w, h)
    this.width = w
    this.height = h
    return true
  }

  dispose(): void {
    disposeTarget(this.gl, this.before)
    disposeTarget(this.gl, this.ping)
    disposeTarget(this.gl, this.pong)
    this.before = this.ping = this.pong = null
  }
}

/** Ancho máximo de la versión reducida de cada frame (fuente de los scopes y de la grilla). */
export const SCOPE_SOURCE_MAX = 960

/** Rectángulo en píxeles, origen arriba a la izquierda. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Source {
  tex: WebGLTexture
  w: number
  h: number
}

interface FrameTex {
  img: FloatImage
  /** versión reducida, float32, generada una vez al cargar */
  thumb: Target
}

/** Celdas de la grilla para n frames dentro de W x H (píxeles), con separación `gap`. */
export function gridLayout(n: number, W: number, H: number, gap: number): Rect[] {
  if (n <= 0) return []
  const cols = n === 1 ? 1 : n <= 4 ? 2 : 3
  const rows = Math.ceil(n / cols)
  const w = Math.max(1, Math.floor((W - gap * (cols + 1)) / cols))
  const h = Math.max(1, Math.floor((H - gap * (rows + 1)) / rows))
  return Array.from({ length: n }, (_, i) => ({
    x: gap + (i % cols) * (w + gap),
    y: gap + Math.floor(i / cols) * (h + gap),
    w,
    h,
  }))
}

export class Renderer {
  readonly g: GL
  readonly canvas: HTMLCanvasElement
  private resample: Program
  private lutProg: Program
  private displayProg: Program
  private imgTex: WebGLTexture | null = null
  private imgW = 0
  private imgH = 0
  private frames: FrameTex[] = []
  private activeImg: FloatImage | null = null
  private view_: Chain
  private scopeChain: Chain
  private gridChain: Chain
  private lutCache: LutCache
  private baker: Baker
  private scopes: Scopes | null = null
  private layers: RenderLayer[] = []
  private p3Canvas = false
  /** última textura procesada del viewport */
  processed: Target | null = null

  view: View = { cx: 0, cy: 0, scale: 1 }
  interpolation: Interpolation = 'tetrahedral'
  display: DisplayTransform = 'rec709-srgb'
  compare: CompareMode = 'off'
  /** posición de la cortina, 0..1 del ancho (de cada celda, en la grilla) */
  split = 0.5
  /** vista grilla: todos los frames con la misma pila de LUTs */
  grid = false
  /** cantidad de versiones reducidas generadas (para tests: una por frame cargado) */
  thumbsCreated = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.g = createGL(canvas)
    const { gl } = this.g
    this.resample = new Program(gl, RESAMPLE_FS)
    this.lutProg = new Program(gl, LUT_FS)
    this.displayProg = new Program(gl, DISPLAY_FS)
    this.view_ = new Chain(gl)
    this.scopeChain = new Chain(gl)
    this.gridChain = new Chain(gl)
    this.lutCache = new LutCache(this.g)
    this.baker = new Baker(this.g)
  }

  get gl(): WebGL2RenderingContext {
    return this.g.gl
  }

  get hasImage(): boolean {
    return this.imgTex !== null
  }

  /** Un solo frame (o ninguno). */
  setImage(img: FloatImage | null): void {
    this.setFrames(img ? [img] : [], 0)
  }

  /**
   * Define los frames y cuál es el principal. Los frames ya cargados (misma imagen) conservan su versión
   * reducida; solo se procesan los nuevos. El principal se sube a resolución completa.
   */
  setFrames(images: FloatImage[], active: number): void {
    const { gl } = this.g
    const prev = new Map(this.frames.map((f) => [f.img, f]))
    const activeImg = images[active] ?? null
    let activeFull: WebGLTexture | null = null
    const next: FrameTex[] = []
    try {
      for (const img of images) {
        const f = prev.get(img)
        if (f) {
          prev.delete(img)
          next.push(f)
          continue
        }
        const full = this.uploadFull(img)
        next.push({ img, thumb: this.makeThumb(full, img.width, img.height) })
        if (img === activeImg && img !== this.activeImg) activeFull = full
        else gl.deleteTexture(full)
      }
    } finally {
      for (const f of prev.values()) disposeTarget(gl, f.thumb)
      this.frames = next
    }
    if (activeImg !== this.activeImg) {
      if (this.imgTex) gl.deleteTexture(this.imgTex)
      this.imgTex = null
      this.imgW = this.imgH = 0
      this.activeImg = activeImg
      if (activeImg) {
        this.imgTex = activeFull ?? this.uploadFull(activeImg)
        this.imgW = activeImg.width
        this.imgH = activeImg.height
      }
    }
  }

  get frameCount(): number {
    return this.frames.length
  }

  private uploadFull(img: FloatImage): WebGLTexture {
    const { gl, caps } = this.g
    if (img.width > caps.maxTextureSize || img.height > caps.maxTextureSize)
      throw new Error(
        `La imagen (${img.width}x${img.height}) excede el tamaño máximo de textura de esta GPU (${caps.maxTextureSize}).`,
      )
    const mip = caps.floatLinear && img.width * img.height <= 40_000_000
    const tex = createTexture(gl, img.width, img.height, 'rgba32f', img.data, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST)
    if (mip) gl.generateMipmap(gl.TEXTURE_2D)
    return tex
  }

  /** Versión reducida en GPU: el mismo remuestreo que usaban los scopes, hecho una sola vez. */
  private makeThumb(full: WebGLTexture, w: number, h: number): Target {
    const { gl, caps } = this.g
    const k = Math.min(1, SCOPE_SOURCE_MAX / w)
    const tw = Math.max(1, Math.round(w * k))
    const th = Math.max(1, Math.round(h * k))
    const t = createTarget(gl, tw, th)
    this.resample
      .use()
      .tex('uImg', 0, full)
      .v2('uImgSize', w, h)
      .v2('uViewport', tw, th)
      .v2('uCenter', w / 2, h / 2)
      .f('uScale', tw / w)
    drawTo(gl, t)
    if (caps.floatLinear) {
      // mipmaps para mostrarla más chica en la grilla sin aliasing
      gl.bindTexture(gl.TEXTURE_2D, t.tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.generateMipmap(gl.TEXTURE_2D)
    }
    this.thumbsCreated++
    return t
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
    const changed = c.width !== w || c.height !== h
    c.width = w
    c.height = h
    return this.view_.ensure(w, h) || changed
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

  /** Remuestrea `img` en `chain` con la vista dada y aplica la pila de LUTs. Devuelve el resultado. */
  private process(chain: Chain, img: Source | null, view: View, applyLayers: boolean): Target {
    const { gl } = this.g
    const before = chain.before!
    if (!img) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, before.fbo)
      gl.viewport(0, 0, before.width, before.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      return before
    }
    this.resample
      .use()
      .tex('uImg', 0, img.tex)
      .v2('uImgSize', img.w, img.h)
      .v2('uViewport', before.width, before.height)
      .v2('uCenter', view.cx, view.cy)
      .f('uScale', view.scale)
    drawTo(gl, before)
    let src = before
    if (!applyLayers) return src
    const interp = this.interpolation === 'trilinear' ? 0 : 1
    for (const layer of this.layers) {
      const lut = isGpuLut(layer.lut) ? layer.lut : this.lutCache.get(layer.lut)
      const dst = src === chain.ping ? chain.pong! : chain.ping!
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
    return src
  }

  private get mainSource(): Source | null {
    return this.imgTex ? { tex: this.imgTex, w: this.imgW, h: this.imgH } : null
  }

  private thumbSource(i: number): Source {
    const t = this.frames[i].thumb
    return { tex: t.tex, w: t.width, h: t.height }
  }

  /** Índice del frame principal en la lista (o -1). */
  private get activeIndex(): number {
    return this.frames.findIndex((f) => f.img === this.activeImg)
  }

  /** Celdas de la grilla en píxeles CSS del canvas. */
  gridCells(): Rect[] {
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth)
    return this.gridCellsPx().map((r) => ({ x: r.x / dpr, y: r.y / dpr, w: r.w / dpr, h: r.h / dpr }))
  }

  private gridCellsPx(): Rect[] {
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth)
    return gridLayout(this.frames.length, this.canvas.width, this.canvas.height, Math.round(8 * dpr))
  }

  private displayUniforms(W: number, splitPx: number): Program {
    return this.displayProg
      .use()
      .i('uCompare', this.compare === 'off' ? 0 : this.compare === 'split' ? 1 : 2)
      .f('uSplit', splitPx)
      .f('uLine', Math.max(1, W / Math.max(1, this.canvas.clientWidth)) * 0.75)
      .i('uDisplay', this.display === 'none' ? 0 : this.display === 'rec709-srgb' ? 1 : 2)
      .v3('uBackground', [0.11, 0.11, 0.11])
  }

  render(): void {
    const { gl } = this.g
    this.resize()
    this.applyCanvasColorSpace()
    const W = this.canvas.width
    const H = this.canvas.height
    if (this.grid && this.frames.length) return this.renderGrid(W, H)
    const out = this.process(this.view_, this.mainSource, this.view, this.compare !== 'before')
    this.processed = out

    this.displayUniforms(W, this.split * W)
      .tex('uBefore', 0, this.view_.before!.tex)
      .tex('uAfter', 1, out.tex)
    gl.uniform2i(this.displayProg.loc('uOffset'), 0, 0)
    drawTo(gl, null, W, H)
  }

  /** Grilla: cada frame (versión reducida) con la misma pila de LUTs, ajustado a su celda. */
  private renderGrid(W: number, H: number): void {
    const { gl } = this.g
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, W, H)
    gl.clearColor(0.11, 0.11, 0.11, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const cells = this.gridCellsPx()
    if (!cells.length) return
    this.gridChain.ensure(cells[0].w, cells[0].h)
    this.processed = null
    cells.forEach((cell, i) => {
      const src = this.thumbSource(i)
      const view = { cx: src.w / 2, cy: src.h / 2, scale: Math.min(cell.w / src.w, cell.h / src.h) }
      const out = this.process(this.gridChain, src, view, this.compare !== 'before')
      const y0 = H - cell.y - cell.h // viewport de GL: origen abajo
      this.displayUniforms(W, this.split * cell.w)
        .tex('uBefore', 0, this.gridChain.before!.tex)
        .tex('uAfter', 1, out.tex)
      gl.uniform2i(this.displayProg.loc('uOffset'), cell.x, y0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(cell.x, y0, cell.w, cell.h)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    })
  }

  /**
   * Procesa la versión reducida del frame `i` (por defecto, el principal) con la misma pila de LUTs que el
   * preview. Es la fuente de los scopes. `before`: sin aplicar los LUTs.
   */
  renderScopeSource(before = false, i = this.activeIndex): Target | null {
    if (i < 0 || i >= this.frames.length) return null
    const src = this.thumbSource(i)
    this.scopeChain.ensure(src.w, src.h)
    return this.process(this.scopeChain, src, { cx: src.w / 2, cy: src.h / 2, scale: 1 }, !before)
  }

  /** Calcula un scope sobre el frame principal procesado (o sobre todos los frames combinados, con `all`). */
  computeScope(mode: ScopeMode, before = false, all = false): ScopeImage | null {
    if (!this.frames.length) return null
    this.scopes ??= new Scopes(this.g)
    if (!all) {
      const src = this.renderScopeSource(before)
      return src ? this.scopes.compute(src, mode) : null
    }
    const self = this
    function* sources() {
      for (let i = 0; i < self.frames.length; i++) yield self.renderScopeSource(before, i)!
    }
    return this.scopes.computeMany(sources(), mode)
  }

  get scopesPrecise(): boolean {
    this.scopes ??= new Scopes(this.g)
    return this.scopes.precise
  }

  dispose(): void {
    const { gl } = this.g
    this.scopes?.dispose()
    if (this.imgTex) gl.deleteTexture(this.imgTex)
    for (const f of this.frames) disposeTarget(gl, f.thumb)
    this.frames = []
    this.lutCache.dispose()
    this.baker.dispose()
    this.view_.dispose()
    this.scopeChain.dispose()
    this.gridChain.dispose()
    this.resample.dispose()
    this.lutProg.dispose()
    this.displayProg.dispose()
  }
}
