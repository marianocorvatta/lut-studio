/**
 * Comparación píxel a píxel entre el resultado esperado (la app) y un still exportado de DaVinci.
 * Matemática pura.
 */
import { sampleLut, type Interpolation, type Lut, type RGB } from './lut'

export interface RgbaImage {
  width: number
  height: number
  /** RGBA float, fila 0 arriba */
  data: Float32Array
}

/** Aplica un LUT a toda la imagen (referencia en CPU, misma interpolación que la GPU y DaVinci). */
export function applyLutToImage(lut: Lut, img: RgbaImage, interp: Interpolation): RgbaImage {
  const n = img.width * img.height
  const out = new Float32Array(n * 4)
  const px: RGB = [0, 0, 0]
  const res: RGB = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    const o = i * 4
    px[0] = img.data[o]
    px[1] = img.data[o + 1]
    px[2] = img.data[o + 2]
    sampleLut(lut, px, interp, res)
    out[o] = res[0]
    out[o + 1] = res[1]
    out[o + 2] = res[2]
    out[o + 3] = 1
  }
  return { width: img.width, height: img.height, data: out }
}

export interface CompareStats {
  width: number
  height: number
  /** error absoluto máximo por canal y global */
  maxPerChannel: [number, number, number]
  max: number
  mean: number
  /** fracción de píxeles con algún canal a más de medio código de 10 bits */
  overHalfCode10: number
  /** fracción de píxeles con algún canal a más de un código de 10 bits */
  overCode10: number
  worst: { x: number; y: number; expected: RGB; actual: RGB }
  /** |diferencia| máxima por píxel (para el mapa), fila 0 arriba */
  diff: Float32Array
}

/** Cuantización del still: el error mínimo esperable es medio paso de 16 bits. */
export const QUANT16 = 0.5 / 65535
export const CODE10 = 1 / 1023

export function compareImages(expected: RgbaImage, actual: RgbaImage, clampExpected = false): CompareStats {
  if (expected.width !== actual.width || expected.height !== actual.height)
    throw new Error(
      `Los tamaños no coinciden: la app da ${expected.width}×${expected.height} y el still es ${actual.width}×${actual.height}. ` +
        'Exportá el still sin escalar (timeline del mismo tamaño que el chart).',
    )
  const n = expected.width * expected.height
  const diff = new Float32Array(n)
  const maxC: [number, number, number] = [0, 0, 0]
  let sum = 0
  let overHalf = 0
  let over1 = 0
  let worstI = 0
  let worstV = -1
  const ex = (v: number) => (clampExpected ? Math.min(1, Math.max(0, v)) : v)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    let m = 0
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(ex(expected.data[o + c]) - actual.data[o + c])
      if (d > maxC[c]) maxC[c] = d
      if (d > m) m = d
      sum += d
    }
    diff[i] = m
    if (m > CODE10 / 2) overHalf++
    if (m > CODE10) over1++
    if (m > worstV) {
      worstV = m
      worstI = i
    }
  }
  const wo = worstI * 4
  return {
    width: expected.width,
    height: expected.height,
    maxPerChannel: maxC,
    max: Math.max(...maxC),
    mean: sum / (n * 3),
    overHalfCode10: overHalf / n,
    overCode10: over1 / n,
    worst: {
      x: worstI % expected.width,
      y: Math.floor(worstI / expected.width),
      expected: [ex(expected.data[wo]), ex(expected.data[wo + 1]), ex(expected.data[wo + 2])],
      actual: [actual.data[wo], actual.data[wo + 1], actual.data[wo + 2]],
    },
    diff,
  }
}

/** Mapa de diferencias como imagen gris: |dif| x amplificación. */
export function diffImage(stats: CompareStats, amplify: number): RgbaImage {
  const n = stats.width * stats.height
  const data = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const v = Math.min(1, stats.diff[i] * amplify)
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
    data[i * 4 + 3] = 1
  }
  return { width: stats.width, height: stats.height, data }
}
