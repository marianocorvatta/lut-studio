/**
 * Geometría de color compartida por las ruedas de Primarias y el vectorscopio: plano Cb/Cr de Y'CbCr Rec.709
 * con +Cb a la derecha y +Cr arriba. Un solo lugar define la orientación, así las dos vistas coinciden.
 * Solo interfaz: nada de esto entra al pipeline ni al .cube.
 */
import { wheelDir } from './grade'

export type RGB3 = [number, number, number]

export const LUMA_709: RGB3 = [0.2126, 0.7152, 0.0722]
/** Cb = (B' - Y') / CB_DIV, Cr = (R' - Y') / CR_DIV (Cb y Cr en [-0.5, 0.5]) */
export const CB_DIV = 1.8556
export const CR_DIV = 1.5748

export function rgbToCbCr(c: RGB3): [number, number] {
  const y = LUMA_709[0] * c[0] + LUMA_709[1] * c[1] + LUMA_709[2] * c[2]
  return [(c[2] - y) / CB_DIV, (c[0] - y) / CR_DIV]
}

/** Ángulo en grados, antihorario desde +Cb, en [0, 360). */
export function cbcrAngle(cb: number, cr: number): number {
  const a = (Math.atan2(cr, cb) * 180) / Math.PI
  return a < 0 ? a + 360 : a
}

export interface ColorVector {
  name: 'R' | 'Mg' | 'B' | 'Cy' | 'G' | 'Yl'
  rgb: RGB3
  cb: number
  cr: number
  /** grados, antihorario desde +Cb */
  angle: number
}

const BASE: [ColorVector['name'], RGB3][] = [
  ['R', [1, 0, 0]],
  ['Mg', [1, 0, 1]],
  ['B', [0, 0, 1]],
  ['Cy', [0, 1, 1]],
  ['G', [0, 1, 0]],
  ['Yl', [1, 1, 0]],
]

/**
 * Primarias y secundarias Rec.709 al 100 %, en el plano Cb/Cr. Ángulos: R 102.9°, Mg 49.7°, B 354.8°,
 * Cy 282.9°, G 229.7°, Yl 174.8°. Los "clásicos" 103/61/347/283/241/167 son del U/V analógico (Rec.601):
 * solo R y Cy coinciden entre los dos estándares.
 */
export const REC709_VECTORS: ColorVector[] = BASE.map(([name, rgb]) => {
  const [cb, cr] = rgbToCbCr(rgb)
  return { name, rgb, cb, cr, angle: cbcrAngle(cb, cr) }
})

/**
 * Color de referencia en el ángulo dado: gris medio desplazado en la misma dirección RGB que usa la rueda
 * (wheelDir), escalado para que el canal más alejado se mueva `amount`. Croma moderada, tono exacto.
 */
export function hueColor(angleDeg: number, amount = 0.3, gray = 0.45): RGB3 {
  const a = (angleDeg * Math.PI) / 180
  const d = wheelDir({ x: Math.cos(a), y: Math.sin(a) })
  const k = amount / Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]))
  return [gray + d[0] * k, gray + d[1] * k, gray + d[2] * k]
}

/** Valores de código (Rec.709 γ, sin cambiar) como color CSS. */
export function cssRgb(c: RGB3, alpha = 1): string {
  const b = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255)
  return alpha === 1 ? `rgb(${b(c[0])} ${b(c[1])} ${b(c[2])})` : `rgb(${b(c[0])} ${b(c[1])} ${b(c[2])} / ${alpha})`
}

/**
 * Eje I de YIQ (NTSC, FCC): la dirección RGB con Y = 0 y Q = 0, es decir Y × Q, con el signo que da I > 0.
 * Es la referencia clásica de tono de piel. Proyectada con la misma matemática Cb/Cr Rec.709 que el vectorscopio
 * y las ruedas da ≈ 130.4°; los "123°" habituales son los del U/V analógico (Rec.601).
 */
export const YIQ = {
  Y: [0.299, 0.587, 0.114] as RGB3,
  I: [0.596, -0.274, -0.322] as RGB3,
  Q: [0.211, -0.523, 0.312] as RGB3,
}

export function yiqIAxis(): RGB3 {
  const [a, b] = [YIQ.Y, YIQ.Q]
  const d: RGB3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const i = YIQ.I[0] * d[0] + YIQ.I[1] * d[1] + YIQ.I[2] * d[2]
  return i < 0 ? [-d[0], -d[1], -d[2]] : d
}

/** Ángulo de la línea de piel en el vectorscopio de la app (grados, antihorario desde +Cb). */
export const SKIN_LINE_ANGLE = (() => {
  const d = yiqIAxis()
  // dirección (no color): Cb/Cr de un desplazamiento d desde cualquier gris
  const y = LUMA_709[0] * d[0] + LUMA_709[1] * d[1] + LUMA_709[2] * d[2]
  return cbcrAngle((d[2] - y) / CB_DIV, (d[0] - y) / CR_DIV)
})()

/** Punto (cb, cr) del plano en un canvas cuadrado de lado S: centro en S/2, +Cb a la derecha, +Cr arriba. */
export function cbcrToCanvas(cb: number, cr: number, S: number): [number, number] {
  return [S / 2 + cb * S, S / 2 - cr * S]
}

/** Extremo de la línea de piel, del centro al borde del círculo (radio S/2). */
export function skinLineEnd(S: number): [number, number] {
  const a = (SKIN_LINE_ANGLE * Math.PI) / 180
  return cbcrToCanvas(Math.cos(a) * 0.5, Math.sin(a) * 0.5, S)
}
