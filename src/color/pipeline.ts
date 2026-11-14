/**
 * Pipeline de color: referencia en CPU (TypeScript puro, float64).
 *
 * `prepare()` convierte los parámetros en un estado derivado (matrices, tablas, banderas)
 * que usan por igual esta referencia y el shader de horneado (gpu/baker.ts). Cualquier
 * operación nueva se agrega en los dos lados y la cubre el test CPU vs GPU.
 *
 * No hay clamp en etapas intermedias: solo al final y es opcional.
 */
import { appleLogDecode, appleLogEncode, AWG_TO_REC709, formulaToneMap, inputMatrix } from './appleLog'
import { evalGrade, prepareGrade, type PreparedGrade } from './grade'
import { evalMatch, prepareMatch, type PreparedMatch } from './match'
import { evalQualifiers, maskWeight, prepareQualifier, prepareQualifiers, type PreparedQualifier } from './qualifiers'
import type { Interpolation, Lut, Lut3D, RGB } from './lut'
import { isIdentity3, mul3, type Mat3 } from './mat3'
import { sampleLut } from './lut'
import type { LookParams } from './params'

export interface PipelineResources {
  /** LUT de conversión Apple Log 2 -> Rec.709 (el oficial de Apple u otro) */
  conversionLut: Lut | null
  /** LUT creativo opcional */
  creativeLut: Lut | null
}

export const CONV_OFF = 0
export const CONV_LUT = 1
export const CONV_FORMULA = 2

export interface Prepared {
  interp: Interpolation
  convMode: typeof CONV_OFF | typeof CONV_LUT | typeof CONV_FORMULA
  convLut: Lut | null
  /** etapa de entrada activa (exposición / balance de blancos distintos de neutro) */
  inputOn: boolean
  /** exposición + balance de blancos, en Apple Wide Gamut lineal */
  inputMatrix: Mat3
  /** conversión por fórmula: AWG lineal -> Rec.709 lineal, con la etapa de entrada ya incluida */
  formulaMatrix: Mat3
  /** etapa Match (al comienzo de la etapa creativa); null = apagada */
  match: PreparedMatch | null
  /** etapa creativa (sobre Rec.709) */
  grade: PreparedGrade
  /** correcciones por color activas, en orden (vacío = etapa apagada) */
  quals: PreparedQualifier[]
  /**
   * Solo para el gotero y la vista de máscara (nunca en el LUT que se exporta): el pipeline se corta antes de la
   * corrección `qualTarget` ('stop') o devuelve su peso en gris ('mask').
   */
  qualTarget: PreparedQualifier | null
  qualMode: 'none' | 'stop' | 'mask'
  creativeLut: Lut | null
  creativeMix: number
  clamp: boolean
  /** avisos para la UI (por ejemplo: conversión activada pero sin LUT cargado) */
  issues: string[]
}

export interface PrepareOptions {
  /** índice (en params.qualifiers) de la corrección donde cortar: gotero ('stop') o máscara ('mask') */
  qualifier?: { index: number; mode: 'stop' | 'mask' }
}

export function prepare(params: LookParams, res: PipelineResources, interp: Interpolation, opts: PrepareOptions = {}): Prepared {
  const issues: string[] = []
  let convMode: Prepared['convMode'] = CONV_OFF
  if (params.conversion.enabled) {
    if (params.conversion.source === 'lut') {
      if (res.conversionLut) convMode = CONV_LUT
      else issues.push('La conversión está activada pero no hay un .cube de conversión cargado: la imagen pasa sin convertir.')
    } else {
      convMode = CONV_FORMULA
    }
  }
  const inM = inputMatrix(params.input.exposure, params.input.temperature, params.input.tint)
  // la etapa de entrada trabaja sobre señal Apple Log: sin conversión no hay señal log que tocar
  const inputOn = convMode !== CONV_OFF && !isIdentity3(inM)
  const creativeOn = params.creativeLut.enabled && res.creativeLut !== null && params.creativeLut.intensity > 0
  return {
    interp,
    convMode,
    convLut: convMode === CONV_LUT ? res.conversionLut : null,
    inputOn,
    inputMatrix: inM,
    formulaMatrix: inputOn ? mul3(AWG_TO_REC709, inM) : AWG_TO_REC709,
    match: prepareMatch(params.match),
    grade: prepareGrade(params),
    ...prepareQualStage(params, opts),
    creativeLut: creativeOn ? res.creativeLut : null,
    creativeMix: creativeOn ? params.creativeLut.intensity : 0,
    clamp: params.output.clamp,
    issues,
  }
}

function prepareQualStage(params: LookParams, opts: PrepareOptions): Pick<Prepared, 'quals' | 'qualTarget' | 'qualMode'> {
  const list = params.qualifiers ?? []
  const q = opts.qualifier
  if (!q || !list[q.index]) return { quals: prepareQualifiers(list), qualTarget: null, qualMode: 'none' }
  return { quals: prepareQualifiers(list.slice(0, q.index)), qualTarget: prepareQualifier(list[q.index]), qualMode: q.mode }
}

const tmp: RGB = [0, 0, 0]

/** Evalúa el pipeline completo para un color. Modifica y devuelve `c`. */
export function evalPipeline(p: Prepared, c: RGB): RGB {
  evalUntilQualifiers(p, c)

  // 3b. Correcciones por color
  if (p.qualMode !== 'none') {
    evalQualifiers(p.quals, c)
    if (p.qualMode === 'mask') c[0] = c[1] = c[2] = maskWeight(p.qualTarget!, c)
    return c
  }
  if (p.quals.length) evalQualifiers(p.quals, c)

  // 3c. LUT creativo con intensidad
  if (p.creativeLut) {
    sampleLut(p.creativeLut, c, p.interp, tmp)
    const k = p.creativeMix
    c[0] += (tmp[0] - c[0]) * k
    c[1] += (tmp[1] - c[1]) * k
    c[2] += (tmp[2] - c[2]) * k
  }

  // 4. Salida
  if (p.clamp) {
    c[0] = c[0] < 0 ? 0 : c[0] > 1 ? 1 : c[0]
    c[1] = c[1] < 0 ? 0 : c[1] > 1 ? 1 : c[1]
    c[2] = c[2] < 0 ? 0 : c[2] > 1 ? 1 : c[2]
  }
  return c
}

/** Entrada, conversión, match y etapa de primarias / curvas / Oklab: todo lo anterior a las correcciones por color. */
function evalUntilQualifiers(p: Prepared, c: RGB): RGB {
  if (p.convMode === CONV_FORMULA) {
    // 1 + 2. Entrada y conversión por fórmula: decodificar, matriz (entrada + gamut), tone mapping, gamma 2.4
    const m = p.formulaMatrix
    const r = appleLogDecode(c[0])
    const g = appleLogDecode(c[1])
    const b = appleLogDecode(c[2])
    c[0] = formulaToneMap(m[0] * r + m[1] * g + m[2] * b)
    c[1] = formulaToneMap(m[3] * r + m[4] * g + m[5] * b)
    c[2] = formulaToneMap(m[6] * r + m[7] * g + m[8] * b)
  } else if (p.convMode === CONV_LUT) {
    // 1. Etapa de entrada sobre la señal log: decodificar, exposición + balance de blancos, volver a codificar
    if (p.inputOn) {
      const m = p.inputMatrix
      const r = appleLogDecode(c[0])
      const g = appleLogDecode(c[1])
      const b = appleLogDecode(c[2])
      c[0] = appleLogEncode(m[0] * r + m[1] * g + m[2] * b)
      c[1] = appleLogEncode(m[3] * r + m[4] * g + m[5] * b)
      c[2] = appleLogEncode(m[6] * r + m[7] * g + m[8] * b)
    }
    // 2. Conversión Apple Log 2 -> Rec.709 con el .cube cargado
    sampleLut(p.convLut!, c, p.interp, c)
  }

  // 3. Etapa creativa: match con la referencia y correcciones estilo DaVinci
  if (p.match) evalMatch(p.match, c)
  evalGrade(p.grade, c)
  return c
}

/** Hornea el pipeline en un LUT 3D de tamaño N (referencia en CPU). */
export function bakeCpu(p: Prepared, size: number): Lut3D {
  const data = new Float32Array(size * size * size * 3)
  const m = size - 1
  const c: RGB = [0, 0, 0]
  let o = 0
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        // misma aritmética que el shader: float32(i) / float32(N - 1)
        c[0] = Math.fround(r / m)
        c[1] = Math.fround(g / m)
        c[2] = Math.fround(b / m)
        evalPipeline(p, c)
        data[o++] = c[0]
        data[o++] = c[1]
        data[o++] = c[2]
      }
  return { kind: '3D', size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }
}

export interface LutDiff {
  max: number
  mean: number
}

/** Diferencia absoluta entre un LUT 3D y otro LUT muestreado en los nodos del primero. */
export function compareLuts(a: Lut3D, b: Lut, interp: Interpolation): LutDiff {
  const n = a.size
  const m = n - 1
  const out: RGB = [0, 0, 0]
  let max = 0
  let sum = 0
  let o = 0
  for (let bz = 0; bz < n; bz++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        sampleLut(b, [r / m, g / m, bz / m], interp, out)
        for (let ch = 0; ch < 3; ch++) {
          const d = Math.abs(a.data[o++] - out[ch])
          if (d > max) max = d
          sum += d
        }
      }
  return { max, mean: sum / a.data.length }
}
