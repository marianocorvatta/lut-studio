/**
 * Parámetros del look. Es lo que se guarda en el proyecto JSON.
 * Los LUTs externos (conversión y creativo) van aparte, en PipelineResources.
 */

export type ConversionSource = 'lut' | 'formula'
export type LutSize = 33 | 65

export interface LookParams {
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
  conversion: { enabled: true, source: 'lut' },
  creativeLut: { enabled: true, intensity: 1 },
  output: { clamp: true },
})
