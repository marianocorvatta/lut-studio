/**
 * Degradés para la barra de los sliders que tocan el color: cada posición de la barra muestra (aproximado, solo
 * pantalla) el color que corresponde a ese valor. Los colores se arman en OkLCh y se pasan a sRGB de 8 bits.
 */
import { hueSwatch } from '../color/oklab'

const N = 13

/** Degradé que recorre [min, max] y pinta en cada punto el color `fn(valor)`. */
export function track(min: number, max: number, fn: (v: number) => string, n = N): string {
  const stops = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    return `${fn(min + (max - min) * t)} ${(t * 100).toFixed(1)}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

/** Color OkLCh con el tono en grados. */
export const lch = (L: number, C: number, hueDeg: number) => hueSwatch((((hueDeg % 360) + 360) % 360) / 360, L, C)
const gray = (L: number) => lch(L, 0, 0)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Rueda de tonos completa (o un tramo) a una luminancia y croma fijos. */
export const hueTrack = (L = 0.7, C = 0.13, from = 0, to = 360) => track(from, to, (h) => lch(L, C, h), 25)

/** Oscuro a claro (exposición, pivote, maestros de las ruedas), opcionalmente teñido con un tono. */
export const lumTrack = (L0 = 0.12, L1 = 0.95, hue?: number, C = 0.05) => track(L0, L1, (L) => (hue === undefined ? gray(L) : lch(L, C, hue)))

/**
 * Saturación general 0..2 (1 = sin cambio): a la izquierda gris, en el centro colores normales, a la derecha
 * intensos. Se dibuja como una rueda de tonos con un velo gris que se va abriendo hacia la derecha.
 */
export function satTrack(L = 0.68, Cmax = 0.18): string {
  const g = gray(L).replace('rgb(', 'rgba(').replace(')', ', ')
  const veil = `linear-gradient(90deg, ${g}1) 0%, ${g}0.55) 50%, ${g}0) 100%)`
  return `${veil}, ${hueTrack(L, Cmax)}`
}

/** Saturación de un tono en particular: de gris (0) a intenso, con el color base en `def`. */
export const hueSatTrack = (hue: number, L: number, min: number, max: number, baseC = 0.1, maxC = 0.2) =>
  track(min, max, (v) => lch(L, v <= 1 ? baseC * v : mix(baseC, maxC, (v - 1) / Math.max(1e-6, max - 1)), hue))

/** Temperatura del iluminante (K): menos de 6500 enfría (azul), más calienta (naranja). */
export const temperatureTrack = (min: number, max: number, neutral = 6500) =>
  track(min, max, (k) => (k < neutral ? lch(0.72, 0.13 * ((neutral - k) / (neutral - min)), 250) : lch(0.75, 0.13 * ((k - neutral) / (max - neutral)), 60)))

/** Tinte: − verde, + magenta. */
export const tintTrack = (min: number, max: number) =>
  track(min, max, (v) => (v < 0 ? lch(0.72, 0.14 * (v / min), 145) : lch(0.68, 0.14 * (v / max), 330)))

/** Cantidad de split toning: de nada (gris) al color del tono elegido. */
export const amountTrack = (hue: number, L: number) => track(0, 1, (v) => lch(L, 0.16 * v, hue))

/** Balance del split toning: − amplía las altas (su color), + amplía las sombras (su color). */
export const balanceTrack = (shadowHue: number, highHue: number) =>
  track(-1, 1, (v) => (v < 0 ? lch(0.72, 0.12 * -v, highHue) : lch(0.55, 0.12 * v, shadowHue)))

/** Croma de un tono: de gris al color más intenso que se puede mostrar. */
export const chromaTrack = (hue: number, L: number, min: number, max: number) =>
  track(min, max, (c) => lch(L, Math.min(c, 0.2), hue))

/** Luminancia de un tono (0..1). */
export const hueLumTrack = (hue: number, C: number, min = 0, max = 1) => track(min, max, (L) => lch(clamp(L, 0.02, 0.98), C, hue))

/** Giro de tono alrededor de un color: el centro es el color de partida. */
export const hueShiftTrack = (hue: number, L: number, C: number, min: number, max: number) => track(min, max, (d) => lch(L, C, hue + d), 25)

/** Cambio de luminancia de un color alrededor de su luminancia base. */
export const lumShiftTrack = (hue: number, L: number, C: number, min: number, max: number) =>
  track(min, max, (d) => lch(clamp(L + d, 0.05, 0.97), C, hue))
