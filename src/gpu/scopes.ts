/**
 * Scopes calculados en GPU: cada píxel de la fuente se dibuja como un punto y se acumula con suma aditiva
 * en una textura float. El resultado (densidades) se lee de vuelta solo para dibujarlo en la interfaz.
 *
 * Los valores son los de salida del pipeline (lo que va al .cube), sin la transformación de display.
 */
import { createTarget, disposeTarget, Program, readTarget, type GL, type Target } from './gl'

export type ScopeMode = 'waveform' | 'parade' | 'vectorscope' | 'histogram'

/** Rango vertical del waveform y del parade. */
export const WAVE_MIN = -0.05
export const WAVE_MAX = 1.05

const SIZES: Record<ScopeMode, [number, number]> = {
  waveform: [512, 256],
  parade: [768, 256],
  vectorscope: [256, 256],
  histogram: [256, 1],
}
const MODE_ID: Record<ScopeMode, number> = { waveform: 0, parade: 1, vectorscope: 2, histogram: 3 }

const POINTS_VS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform ivec2 uSrcSize;
uniform int uMode;
uniform float uWeight;
flat out vec4 vC;
void main() {
  int x = gl_VertexID % uSrcSize.x;
  int y = gl_VertexID / uSrcSize.x;
  vec4 s = texelFetch(uSrc, ivec2(x, y), 0);
  gl_PointSize = 1.0;
  vC = vec4(0.0);
  if (s.a < 0.5) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); return; } // fuera de la imagen
  vec3 c = s.rgb;
  int ch = gl_InstanceID;
  float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float fx = (float(x) + 0.5) / float(uSrcSize.x);
  vec2 p;
  if (uMode == 0) {
    p = vec2(fx, (Y - ${WAVE_MIN}) / (${WAVE_MAX} - (${WAVE_MIN})));
    vC = vec4(uWeight);
  } else if (uMode == 1) {
    p = vec2((float(ch) + fx) / 3.0, (c[ch] - ${WAVE_MIN}) / (${WAVE_MAX} - (${WAVE_MIN})));
    vC[ch] = uWeight;
  } else if (uMode == 2) {
    // Y'CbCr Rec.709: Cb y Cr en [-0.5, 0.5]
    p = vec2(0.5 + (c.b - Y) / 1.8556, 0.5 + (c.r - Y) / 1.5748);
    vC = vec4(uWeight);
  } else {
    float v = clamp(c[ch], 0.0, 1.0);
    p = vec2((floor(v * 255.0 + 0.5) + 0.5) / 256.0, 0.5);
    vC[ch] = uWeight;
  }
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const POINTS_FS = `#version 300 es
precision highp float;
flat in vec4 vC;
out vec4 o;
void main() { o = vC; }`

export interface ScopeImage {
  mode: ScopeMode
  width: number
  height: number
  /** densidad RGBA por celda, fila 0 abajo */
  data: Float32Array
  /** cantidad de píxeles de imagen que entraron al scope */
  samples: number
}

export class Scopes {
  private g: GL
  private prog: Program
  private targets = new Map<ScopeMode, Target>()
  /** acumulación en float32 si la GPU permite mezclar en float32; si no, en float16 */
  readonly precise: boolean

  constructor(g: GL) {
    this.g = g
    this.prog = new Program(g.gl, POINTS_FS, POINTS_VS)
    this.precise = Boolean(g.gl.getExtension('EXT_float_blend'))
  }

  compute(src: Target, mode: ScopeMode): ScopeImage {
    const { gl } = this.g
    let t = this.targets.get(mode)
    if (!t) {
      const [w, h] = SIZES[mode]
      t = createTarget(gl, w, h, this.precise ? 'rgba32f' : 'rgba16f')
      this.targets.set(mode, t)
    }
    // en float16 los conteos grandes pierden precisión: se usa un peso chico (solo afecta la escala de display)
    const weight = this.precise ? 1 : 1 / 64
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.viewport(0, 0, t.width, t.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ONE)
    this.prog.use().tex('uSrc', 0, src.tex).i('uMode', MODE_ID[mode]).f('uWeight', weight)
    gl.uniform2i(this.prog.loc('uSrcSize'), src.width, src.height)
    const instances = mode === 'parade' || mode === 'histogram' ? 3 : 1
    gl.drawArraysInstanced(gl.POINTS, 0, src.width * src.height, instances)
    gl.disable(gl.BLEND)
    const data = readTarget(gl, t)
    if (weight !== 1) for (let i = 0; i < data.length; i++) data[i] /= weight
    return { mode, width: t.width, height: t.height, data, samples: src.width * src.height }
  }

  dispose(): void {
    for (const t of this.targets.values()) disposeTarget(this.g.gl, t)
    this.targets.clear()
    this.prog.dispose()
  }
}
