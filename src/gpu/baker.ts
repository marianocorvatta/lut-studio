/**
 * Horneado del LUT en GPU: genera la grilla identidad NxNxN en el shader, la pasa por el
 * pipeline completo y deja el resultado en una textura RGBA32F de N*N x N (x = r + g*N, y = b),
 * que es el orden del .cube. Esa misma textura es la que usa el preview y la que se exporta.
 *
 * El shader replica operación por operación a color/pipeline.ts (referencia en CPU).
 */
import type { Lut, Lut3D } from '../color/lut'
import { APPLE_LOG_PT, TONE } from '../color/appleLog'
import { APPLE_LOG_CURVE as K } from '../color/appleLog2.constants'
import { CONV_FORMULA, CONV_LUT, type Prepared } from '../color/pipeline'
import { CURVE_N } from '../color/grade'
import { createTarget, createTexture, disposeTarget, drawTo, Program, readTarget, type GL, type Target } from './gl'
import { GRADE_GLSL } from './gradeGlsl'
import { MATCH_GLSL } from './matchGlsl'
import { QUAL_GLSL, QUAL_SLOTS } from './qualifierGlsl'
import type { PreparedQualifier } from '../color/qualifiers'
import { LutCache, type GpuLut } from './lutCache'
import { LUT_GLSL } from './lutGlsl'

const BAKE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform int uN;
uniform int uInterp;

uniform int uConvMode;
uniform sampler2D uConvLut;
uniform int uConvSize;
uniform int uConvKind;
uniform vec3 uConvMin;
uniform vec3 uConvMax;

uniform int uInputOn;
uniform mat3 uInputMatrix;
uniform mat3 uFormulaMatrix;

uniform int uCreativeOn;
uniform sampler2D uCreativeLut;
uniform int uCreativeSize;
uniform int uCreativeKind;
uniform vec3 uCreativeMin;
uniform vec3 uCreativeMax;
uniform float uCreativeMix;

uniform int uClamp;
out vec4 o;
${LUT_GLSL}
${GRADE_GLSL}
${MATCH_GLSL}
${QUAL_GLSL}
// --- Apple Log (constantes de color/appleLog2.constants.ts) ---
const float AL_R0 = ${K.R0};
const float AL_RT = ${K.Rt};
const float AL_C = ${K.c};
const float AL_BETA = ${K.beta};
const float AL_GAMMA = ${K.gamma};
const float AL_DELTA = ${K.delta};
const float AL_PT = ${APPLE_LOG_PT};

float appleLogDecode1(float p) {
  if (p >= AL_PT) return exp2((p - AL_DELTA) / AL_GAMMA) - AL_BETA;
  if (p >= 0.0) return sqrt(p / AL_C) + AL_R0;
  return AL_R0;
}
vec3 appleLogDecode(vec3 p) { return vec3(appleLogDecode1(p.r), appleLogDecode1(p.g), appleLogDecode1(p.b)); }

float appleLogEncode1(float r) {
  if (r >= AL_RT) return AL_GAMMA * log2(r + AL_BETA) + AL_DELTA;
  if (r >= AL_R0) { float d = r - AL_R0; return AL_C * d * d; }
  return 0.0;
}
vec3 appleLogEncode(vec3 r) { return vec3(appleLogEncode1(r.r), appleLogEncode1(r.g), appleLogEncode1(r.b)); }

// tone mapping de la conversión por fórmula (Naka-Rushton por canal) + gamma 2.4
vec3 formulaToneMap(vec3 l) {
  vec3 ln = pow(max(l, 0.0), vec3(${TONE.n}));
  return pow(${TONE.s} * ln / (ln + ${TONE.kn}), vec3(${TONE.invGamma}));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = vec3(float(p.x % uN), float(p.x / uN), float(p.y)) / float(uN - 1);

  if (uConvMode == ${CONV_FORMULA}) {
    // 1 + 2. Entrada y conversión por fórmula
    c = formulaToneMap(uFormulaMatrix * appleLogDecode(c));
  } else if (uConvMode == ${CONV_LUT}) {
    // 1. Etapa de entrada sobre la señal log
    if (uInputOn == 1) c = appleLogEncode(uInputMatrix * appleLogDecode(c));
    // 2. Conversión Apple Log 2 -> Rec.709 con el .cube cargado
    c = applyLut(uConvLut, uConvSize, uConvKind, uInterp, uConvMin, uConvMax, c);
  }

  // 3. Etapa creativa: match con la referencia, correcciones estilo DaVinci y el LUT creativo con intensidad
  if (uMatchOn == 1) c = matchStage(c);
  c = gradeStage(c);

  // 3b. Correcciones por color (y, solo para el gotero / la máscara, el corte antes de la corrección objetivo)
  if (uQualN > 0) c = qualStage(c);
  if (uQualMode == 1) { o = vec4(c, 1.0); return; }
  if (uQualMode == 2) { float w = qualMaskOf(uQualN, c); o = vec4(w, w, w, 1.0); return; }

  // 3c. LUT creativo con intensidad
  if (uCreativeOn == 1) {
    vec3 t = applyLut(uCreativeLut, uCreativeSize, uCreativeKind, uInterp, uCreativeMin, uCreativeMax, c);
    c += (t - c) * uCreativeMix;
  }

  // 4. Salida
  if (uClamp == 1) c = clamp(c, 0.0, 1.0);
  o = vec4(c, 1.0);
}`

export class Baker {
  private g: GL
  private prog: Program
  private cache: LutCache
  private dummy: WebGLTexture
  private curves: WebGLTexture
  private target: Target | null = null
  private size = 0
  private cpuCopy: Lut3D | null = null

  constructor(g: GL) {
    this.g = g
    this.prog = new Program(g.gl, BAKE_FS)
    this.cache = new LutCache(g)
    this.dummy = createTexture(g.gl, 1, 1, 'rgb32f', new Float32Array(3))
    this.curves = createTexture(g.gl, CURVE_N, 2, 'rgba32f', null)
  }

  /** Hornea el pipeline. Devuelve el LUT en GPU, listo para aplicarlo a la imagen. */
  bake(p: Prepared, size: number): GpuLut {
    const { gl } = this.g
    if (!this.target || this.size !== size) {
      if (size * size > this.g.caps.maxTextureSize) throw new Error(`Tamaño de LUT ${size} no soportado por esta GPU.`)
      disposeTarget(gl, this.target)
      this.target = createTarget(gl, size * size, size)
      this.size = size
    }
    const used: Lut[] = []
    if (p.convLut) used.push(p.convLut)
    if (p.creativeLut) used.push(p.creativeLut)
    this.cache.retain(used)
    // subir texturas ANTES de enlazar unidades: createTexture cambia el binding de la unidad activa
    for (const lut of used) this.cache.get(lut)

    // tablas de curvas: misma Float32Array que usa la referencia en CPU
    gl.bindTexture(gl.TEXTURE_2D, this.curves)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, CURVE_N, 2, gl.RGBA, gl.FLOAT, p.grade.table)

    const prog = this.prog.use()
    prog.i('uN', size).i('uInterp', p.interp === 'trilinear' ? 0 : 1).i('uClamp', p.clamp ? 1 : 0)

    prog.i('uConvMode', p.convMode)
    prog.i('uInputOn', p.inputOn ? 1 : 0).m3('uInputMatrix', p.inputMatrix).m3('uFormulaMatrix', p.formulaMatrix)
    this.bindLut('uConv', 0, p.convLut)

    prog.i('uCreativeOn', p.creativeLut ? 1 : 0).f('uCreativeMix', p.creativeMix)
    this.bindLut('uCreative', 1, p.creativeLut)

    const gr = p.grade
    prog.tex('uCurves', 2, this.curves)
    prog.i('uLggOn', gr.lggOn ? 1 : 0).v3('uLift', gr.lift).v3('uGain', gr.gain).v3('uGammaExp', gr.gammaExp)
    prog.i('uOffsetOn', gr.offsetOn ? 1 : 0).v3('uOffset', gr.offset)
    prog.i('uContrastOn', gr.contrastOn ? 1 : 0).f('uContrast', gr.contrast).f('uPivot', gr.pivot)
    prog.i('uCurvesOn', gr.curvesOn ? 1 : 0)
    gl.uniform4i(prog.loc('uCurveMask'), ...(gr.curveMask.map(Number) as [number, number, number, number]))
    prog.i('uOkOn', gr.okOn ? 1 : 0).f('uSaturation', gr.saturation)
    prog.i('uTonalOn', gr.tonalOn ? 1 : 0).v3('uTonalSat', [gr.satShadows, gr.satMids, gr.satHighs])
    gl.uniform4i(prog.loc('uHueMask'), ...(gr.hueMask.map(Number) as [number, number, number, number]))
    prog.i('uSplitOn', gr.splitOn ? 1 : 0).f('uSplitBalance', gr.splitBalance)
    gl.uniform2f(prog.loc('uSplitShadow'), gr.splitShadow[0], gr.splitShadow[1])
    gl.uniform2f(prog.loc('uSplitHigh'), gr.splitHigh[0], gr.splitHigh[1])

    const pm = p.match
    prog.i('uMatchOn', pm ? 1 : 0)
    if (pm) {
      prog.f('uMatchK', pm.k).f('uMatchProtect', pm.protect).i('uMatchN', pm.n)
      gl.uniform1fv(prog.loc('uMatchX'), pm.x)
      gl.uniform1fv(prog.loc('uMatchY'), pm.y)
      gl.uniform1fv(prog.loc('uMatchM'), pm.m)
      gl.uniform4fv(prog.loc('uMatchA'), pm.A)
      gl.uniform2fv(prog.loc('uMatchT'), pm.t)
      gl.uniform2f(prog.loc('uMatchSkin'), pm.skin[0], pm.skin[1])
    }

    this.setQualifiers(p.quals, p.qualTarget, p.qualMode)

    drawTo(gl, this.target)
    this.cpuCopy = null
    return { tex: this.target.tex, size, kind: '3D', domainMin: [0, 0, 0], domainMax: [1, 1, 1] }
  }

  private setQualifiers(list: PreparedQualifier[], target: PreparedQualifier | null, mode: Prepared['qualMode']): void {
    const { gl } = this.g
    const prog = this.prog
    const all = target ? [...list, target] : list
    const hue = new Float32Array(QUAL_SLOTS * 4)
    const chroma = new Float32Array(QUAL_SLOTS * 3)
    const luma = new Float32Array(QUAL_SLOTS * 3)
    const adj = new Float32Array(QUAL_SLOTS * 4)
    all.forEach((q, i) => {
      hue.set([...q.hue, q.hueFull ? 1 : 0], i * 4)
      chroma.set(q.chroma, i * 3)
      luma.set(q.luma, i * 3)
      adj.set([q.rot, q.sat, q.lum, q.intensity], i * 4)
    })
    prog.i('uQualN', list.length).i('uQualMode', mode === 'stop' ? 1 : mode === 'mask' ? 2 : 0)
    gl.uniform4fv(prog.loc('uQualHue'), hue)
    gl.uniform3fv(prog.loc('uQualChroma'), chroma)
    gl.uniform3fv(prog.loc('uQualLuma'), luma)
    gl.uniform4fv(prog.loc('uQualAdj'), adj)
  }

  private bindLut(prefix: string, unit: number, lut: Lut | null): void {
    const prog = this.prog
    if (!lut) {
      prog.tex(`${prefix}Lut`, unit, this.dummy).i(`${prefix}Size`, 2).i(`${prefix}Kind`, 0)
      prog.v3(`${prefix}Min`, [0, 0, 0]).v3(`${prefix}Max`, [1, 1, 1])
      return
    }
    const gpu = this.cache.get(lut)
    prog.tex(`${prefix}Lut`, unit, gpu.tex).i(`${prefix}Size`, gpu.size).i(`${prefix}Kind`, gpu.kind === '3D' ? 0 : 1)
    prog.v3(`${prefix}Min`, gpu.domainMin).v3(`${prefix}Max`, gpu.domainMax)
  }

  /** Lee de la GPU el LUT horneado (float32). Es exactamente lo que se exporta al .cube. */
  read(): Lut3D {
    if (this.cpuCopy) return this.cpuCopy
    if (!this.target) throw new Error('Todavía no se horneó ningún LUT.')
    const rgba = readTarget(this.g.gl, this.target)
    const n = this.size
    const data = new Float32Array(n * n * n * 3)
    for (let i = 0, o = 0; i < rgba.length; i += 4) {
      data[o++] = rgba[i]
      data[o++] = rgba[i + 1]
      data[o++] = rgba[i + 2]
    }
    this.cpuCopy = { kind: '3D', size: n, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }
    return this.cpuCopy
  }

  dispose(): void {
    const { gl } = this.g
    disposeTarget(gl, this.target)
    gl.deleteTexture(this.dummy)
    gl.deleteTexture(this.curves)
    this.cache.dispose()
    this.prog.dispose()
  }
}
