/**
 * Oklab (Björn Ottosson, 2020). Matrices de https://bottosson.github.io/posts/oklab/
 * RGB lineal con primarios Rec.709/sRGB <-> LMS <-> Lab.
 */
import type { Mat3 } from './mat3'

export const OK_M1: Mat3 = [0.4122214708, 0.5363325363, 0.0514459929, 0.2119034982, 0.6806995451, 0.1073969566, 0.0883024619, 0.2817188376, 0.6299787005]
export const OK_M2: Mat3 = [0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371, 0.7827717662, -0.808675766]
export const OK_M2_INV: Mat3 = [1, 0.3963377774, 0.2158037573, 1, -0.1055613458, -0.0638541728, 1, -0.0894841775, -1.291485548]
export const OK_M1_INV: Mat3 = [4.0767416621, -3.3077115913, 0.2309699292, -1.2684380046, 2.6097574011, -0.3413193965, -0.0041960863, -0.7034186147, 1.707614701]

/** Potencia que conserva el signo: sign(x) * |x|^e. */
export const sgnpow = (x: number, e: number): number => (x < 0 ? -((-x) ** e) : x ** e)

export function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(OK_M1[0] * r + OK_M1[1] * g + OK_M1[2] * b)
  const m = Math.cbrt(OK_M1[3] * r + OK_M1[4] * g + OK_M1[5] * b)
  const s = Math.cbrt(OK_M1[6] * r + OK_M1[7] * g + OK_M1[8] * b)
  return [
    OK_M2[0] * l + OK_M2[1] * m + OK_M2[2] * s,
    OK_M2[3] * l + OK_M2[4] * m + OK_M2[5] * s,
    OK_M2[6] * l + OK_M2[7] * m + OK_M2[8] * s,
  ]
}

export function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + OK_M2_INV[1] * a + OK_M2_INV[2] * b) ** 3
  const m = (L + OK_M2_INV[4] * a + OK_M2_INV[5] * b) ** 3
  const s = (L + OK_M2_INV[7] * a + OK_M2_INV[8] * b) ** 3
  return [
    OK_M1_INV[0] * l + OK_M1_INV[1] * m + OK_M1_INV[2] * s,
    OK_M1_INV[3] * l + OK_M1_INV[4] * m + OK_M1_INV[5] * s,
    OK_M1_INV[6] * l + OK_M1_INV[7] * m + OK_M1_INV[8] * s,
  ]
}

/** Color sRGB de 8 bits (para dibujar la interfaz) de un tono OkLCh. `hue` en vueltas (0..1). */
export function hueSwatch(hue: number, L = 0.7, C = 0.12): string {
  const a = C * Math.cos(hue * 2 * Math.PI)
  const b = C * Math.sin(hue * 2 * Math.PI)
  const enc = (v: number) => {
    const c = Math.min(1, Math.max(0, v))
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))
  }
  const [r, g, bl] = oklabToLinear(L, a, b)
  return `rgb(${enc(r)}, ${enc(g)}, ${enc(bl)})`
}
