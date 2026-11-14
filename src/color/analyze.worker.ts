/// <reference lib="webworker" />
/**
 * Worker del diagnóstico: el análisis no bloquea los sliders. Guarda una muestra de los píxeles de los frames
 * (valores de entrada del LUT) para calcular qué fracción cae en celdas con problemas.
 */
import { analyzeLut, pixelStats, type AnalyzeOptions, type LutDiagnostics, type PixelStats } from './analyze'
import { sampleLut3D, type Interpolation, type Lut3D, type RGB } from './lut'

export type WorkerIn =
  | { type: 'pixels'; pixels: Float32Array }
  | {
      type: 'analyze'
      id: number
      /** LUT completo sin clamp final: recorte */
      full: Lut3D
      /** LUT del look solo (Rec.709 -> Rec.709), sin clamp: quiebres e inversiones */
      look: Lut3D
      /** entrada + conversión (sin clamp), para llevar los píxeles al dominio del look; null: sin conversión */
      pre: Lut3D | null
      opts: AnalyzeOptions
      interp: Interpolation
    }

export type Summary = Omit<LutDiagnostics, 'nodeFlags'>

export interface WorkerOut {
  id: number
  size: number
  full: Summary
  look: Summary
  /** bits por nodo del look (quiebres e inversiones), para el overlay */
  lookFlags: Uint8Array
  pixels: PixelStats
}

let pixels: Float32Array = new Float32Array(0)

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data
  if (msg.type === 'pixels') {
    pixels = msg.pixels
    return
  }
  const { id, full, look, pre, opts, interp } = msg
  const f = analyzeLut(full, opts)
  const l = analyzeLut(look, opts)
  // píxeles en el dominio del look: después de la entrada y la conversión
  let lookPixels = pixels
  if (pre) {
    lookPixels = new Float32Array(pixels.length)
    const out: RGB = [0, 0, 0]
    for (let i = 0; i < pixels.length; i += 3) {
      sampleLut3D(pre, [pixels[i], pixels[i + 1], pixels[i + 2]], 'trilinear', out)
      lookPixels[i] = out[0]
      lookPixels[i + 1] = out[1]
      lookPixels[i + 2] = out[2]
    }
  }
  const pl = pixelStats(l.nodeFlags, look.size, lookPixels)
  // recorte exacto por píxel (como el overlay): el LUT completo sin clamp aplicado a cada píxel de la muestra
  let low = 0
  let high = 0
  const o: RGB = [0, 0, 0]
  const count = pixels.length / 3
  for (let i = 0; i < pixels.length; i += 3) {
    sampleLut3D(full, [pixels[i], pixels[i + 1], pixels[i + 2]], interp, o)
    if (o[0] < 0 || o[1] < 0 || o[2] < 0) low++
    else if (o[0] > 1 || o[1] > 1 || o[2] > 1) high++
  }
  const k = count ? 1 / count : 0
  const { nodeFlags: _f, ...fullSummary } = f
  const { nodeFlags: lookFlags, ...lookSummary } = l
  void _f
  const res: WorkerOut = {
    id,
    size: full.size,
    full: fullSummary,
    look: lookSummary,
    lookFlags,
    pixels: { samples: count, clipLow: low * k, clipHigh: high * k, break: pl.break, inversion: pl.inversion },
  }
  ;(self as unknown as Worker).postMessage(res, [lookFlags.buffer])
}
