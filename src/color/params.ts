/**
 * Parámetros del look. Es lo que se guarda en el proyecto JSON.
 * Los LUTs externos (conversión y creativo) van aparte, en PipelineResources.
 */
import { defaultMatch, type MatchParams } from './match'
import { MAX_QUALIFIERS, normalizeQualifier, type Qualifier } from './qualifiers'

export type ConversionSource = 'lut' | 'formula'
export type LutSize = 33 | 65

/** Punto de control de una curva. */
export interface Pt {
  x: number
  y: number
}

/** Rueda de color: posición en el disco unitario (x = Cb, y = Cr, como un vectorscopio) + control maestro. */
export interface Wheel {
  x: number
  y: number
  master: number
}

export type WheelName = 'lift' | 'gamma' | 'gain' | 'offset'
export type RgbCurveName = 'master' | 'r' | 'g' | 'b'
export type HueCurveName = 'hueHue' | 'hueSat' | 'hueLum' | 'lumSat'

export interface LookParams {
  /** Etapa de entrada, sobre la señal log (antes de la conversión). Solo actúa con la conversión activada. */
  input: {
    /** exposición en stops */
    exposure: number
    /** temperatura del iluminante de la escena, en kelvin (6500 = neutro) */
    temperature: number
    /** tinte: + magenta, - verde (0 = neutro) */
    tint: number
  }
  conversion: {
    /** apagado: la imagen pasa sin conversión (material que no es log) */
    enabled: boolean
    source: ConversionSource
  }
  /** Etapa creativa, sobre Rec.709 gamma 2.4 */
  grade: {
    /** maestro: lift y offset 0 = neutro; gamma 0 = neutro (en stops de exponente); gain 1 = neutro */
    lift: Wheel
    gamma: Wheel
    gain: Wheel
    offset: Wheel
    contrast: number
    pivot: number
    saturation: number
    satShadows: number
    satMids: number
    satHighs: number
  }
  /** Curvas RGB: x e y en 0..1. Por defecto, la diagonal. */
  curves: Record<RgbCurveName, Pt[]>
  /**
   * Curvas en OkLCh. x = tono (0..1, periódico) o luminancia (lumSat); y en -1..1 con 0 = sin cambio.
   * hueHue: y = ±60° de rotación. hueSat / lumSat: factor de saturación 1 + y. hueLum: y = ±0.3 de L.
   */
  hueCurves: Record<HueCurveName, Pt[]>
  splitTone: {
    /** tono en grados (ángulo OkLCh) */
    shadowHue: number
    shadowAmount: number
    highHue: number
    highAmount: number
    /** -1..1: mueve el límite entre sombras y altas */
    balance: number
  }
  creativeLut: {
    enabled: boolean
    /** 0..1 */
    intensity: number
  }
  output: {
    /** clamp final a [0, 1] */
    clamp: boolean
  }
  /** etapa Match (al comienzo de la etapa creativa): el modelo calculado viaja con el look */
  match: MatchParams
  /** correcciones por color (después de primarias, curvas y Oklab; antes del LUT creativo) */
  qualifiers: Qualifier[]
}

export const DEFAULT_PIVOT = 0.435

const diagonal = (): Pt[] => [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
]

export const defaultParams = (): LookParams => ({
  input: { exposure: 0, temperature: 6500, tint: 0 },
  conversion: { enabled: true, source: 'lut' },
  grade: {
    lift: { x: 0, y: 0, master: 0 },
    gamma: { x: 0, y: 0, master: 0 },
    gain: { x: 0, y: 0, master: 1 },
    offset: { x: 0, y: 0, master: 0 },
    contrast: 1,
    pivot: DEFAULT_PIVOT,
    saturation: 1,
    satShadows: 1,
    satMids: 1,
    satHighs: 1,
  },
  curves: { master: diagonal(), r: diagonal(), g: diagonal(), b: diagonal() },
  hueCurves: { hueHue: [], hueSat: [], hueLum: [], lumSat: [] },
  splitTone: { shadowHue: 250, shadowAmount: 0, highHue: 70, highAmount: 0, balance: 0 },
  creativeLut: { enabled: true, intensity: 1 },
  output: { clamp: true },
  match: defaultMatch(),
  qualifiers: [],
})

/** Completa un objeto de parámetros (por ejemplo, de un proyecto viejo) con los valores por defecto. */
export function normalizeParams(raw: unknown): LookParams {
  const def = defaultParams()
  const merge = (d: unknown, r: unknown): unknown => {
    if (Array.isArray(d)) return Array.isArray(r) ? r : d
    if (d !== null && typeof d === 'object') {
      const out: Record<string, unknown> = {}
      const ro = r !== null && typeof r === 'object' ? (r as Record<string, unknown>) : {}
      for (const k of Object.keys(d)) out[k] = merge((d as Record<string, unknown>)[k], ro[k])
      return out
    }
    return typeof r === typeof d ? r : d
  }
  const out = merge(def, raw) as LookParams
  out.qualifiers = out.qualifiers.slice(0, MAX_QUALIFIERS).map(normalizeQualifier)
  return out
}
