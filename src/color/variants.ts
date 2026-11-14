/**
 * Variantes del mismo look, armadas solo cambiando parámetros (la matemática del pipeline no cambia):
 * - look solo: etapa creativa completa (incluido el LUT creativo y su intensidad) sobre Rec.709 γ2.4,
 *   sin conversión ni etapa de entrada (la entrada trabaja sobre la señal log).
 * - conversión: la conversión sola (opcionalmente con la etapa de entrada), con el look en neutro.
 */
import { defaultParams, type LookParams } from './params'
import { CONV_OFF, prepare, type Prepared } from './pipeline'
import type { Interpolation, Lut } from './lut'

export interface StudioLuts {
  conversionLut: Lut | null
  creativeLut: Lut | null
}

/** Parámetros del look solo: la conversión apagada (y con ella la etapa de entrada). */
export function lookOnlyParams(params: LookParams): LookParams {
  const p = structuredClone(params)
  p.conversion.enabled = false
  p.input = defaultParams().input
  return p
}

export function prepareLookOnly(params: LookParams, luts: StudioLuts, interp: Interpolation, clamp = params.output.clamp): Prepared {
  const p = lookOnlyParams(params)
  p.output.clamp = clamp
  return prepare(p, luts, interp)
}

/** La conversión sola (con la etapa de entrada si `withInput`), look neutro, sin clamp. null si no hay conversión. */
export function prepareConversion(params: LookParams, luts: StudioLuts, interp: Interpolation, withInput: boolean): Prepared | null {
  if (!params.conversion.enabled) return null
  const p = defaultParams()
  p.conversion = structuredClone(params.conversion)
  if (withInput) p.input = structuredClone(params.input)
  p.output.clamp = false
  const prepared = prepare(p, { conversionLut: luts.conversionLut, creativeLut: null }, interp)
  return prepared.convMode === CONV_OFF ? null : prepared
}

/** ¿La etapa de entrada tiene algún valor distinto del neutro? */
export function inputIsNeutral(params: LookParams): boolean {
  const d = defaultParams().input
  return params.input.exposure === d.exposure && params.input.temperature === d.temperature && params.input.tint === d.tint
}
