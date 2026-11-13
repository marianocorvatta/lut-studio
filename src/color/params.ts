/**
 * Parámetros del look. Es lo que se guarda en el proyecto JSON.
 * Los LUTs externos (conversión y creativo) van aparte, en PipelineResources.
 */

export type ConversionSource = 'lut' | 'formula'
export type LutSize = 33 | 65

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
  creativeLut: {
    enabled: boolean
    /** 0..1 */
    intensity: number
  }
  output: {
    /** clamp final a [0, 1] */
    clamp: boolean
  }
}

export const defaultParams = (): LookParams => ({
  input: { exposure: 0, temperature: 6500, tint: 0 },
  conversion: { enabled: true, source: 'lut' },
  creativeLut: { enabled: true, intensity: 1 },
  output: { clamp: true },
})
