/**
 * Chart de prueba para validar contra DaVinci: rampas de gris, rampas por canal, escalones que caen en los nodos
 * de un LUT 33, barrido de tonos y bloques de colores aleatorios (cubren todo el cubo RGB, donde trilineal y
 * tetraédrica difieren). Valores de 16 bits exactos. 1920x1080 para coincidir con un timeline HD sin escalar.
 * Lógica pura (sin APIs de navegador).
 */
import { writeTiff16 } from './tiffWrite'
import type { FloatImage } from './image'

export const CHART_W = 1920
export const CHART_H = 1080

export interface ChartRegion {
  name: string
  y0: number
  y1: number
}

export const CHART_REGIONS: ChartRegion[] = [
  { name: 'Rampa de gris continua', y0: 0, y1: 120 },
  { name: 'Gris en 33 escalones (nodos de un LUT 33)', y0: 120, y1: 220 },
  { name: 'Gris en 65 escalones (nodos de un LUT 65)', y0: 220, y1: 300 },
  { name: 'Rampa roja', y0: 300, y1: 380 },
  { name: 'Rampa verde', y0: 380, y1: 460 },
  { name: 'Rampa azul', y0: 460, y1: 540 },
  { name: 'Rampas cian, magenta, amarillo', y0: 540, y1: 660 },
  { name: 'Barrido de tonos con luminosidad y saturación variables', y0: 660, y1: 870 },
  { name: 'Bloques aleatorios de 8x8 (todo el cubo RGB)', y0: 870, y1: 1080 },
]

const U16 = 65535
const q = (v: number) => Math.max(0, Math.min(U16, Math.round(v * U16)))

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function hsv(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [f(5), f(3), f(1)]
}

/** Valores de 16 bits del chart, RGB intercalado, fila 0 arriba. */
export function generateChart(width = CHART_W, height = CHART_H): Uint16Array {
  const out = new Uint16Array(width * height * 3)
  const sy = height / CHART_H
  const region = (y: number) => CHART_REGIONS.findIndex((r) => y >= r.y0 * sy && y < r.y1 * sy)
  const rand = rng(20261113)
  const blocks = new Map<number, [number, number, number]>()
  for (let y = 0; y < height; y++) {
    const ri = region(y)
    const r = CHART_REGIONS[ri]
    const ty = (y - r.y0 * sy) / ((r.y1 - r.y0) * sy)
    for (let x = 0; x < width; x++) {
      const t = x / (width - 1)
      let c: [number, number, number]
      switch (ri) {
        case 0:
          c = [t, t, t]
          break
        case 1: {
          const v = Math.min(32, Math.floor((x / width) * 33)) / 32
          c = [v, v, v]
          break
        }
        case 2: {
          const v = Math.min(64, Math.floor((x / width) * 65)) / 64
          c = [v, v, v]
          break
        }
        case 3:
          c = [t, 0, 0]
          break
        case 4:
          c = [0, t, 0]
          break
        case 5:
          c = [0, 0, t]
          break
        case 6: {
          const k = Math.min(2, Math.floor(ty * 3))
          c = k === 0 ? [0, t, t] : k === 1 ? [t, 0, t] : [t, t, 0]
          break
        }
        case 7: {
          const half = ty < 0.5
          c = half ? hsv(t, 1, 1 - ty * 2 * 0.9) : hsv(t, 1 - (ty - 0.5) * 2, 1)
          break
        }
        default: {
          const key = Math.floor(x / 8) * 100000 + Math.floor(y / 8)
          let b = blocks.get(key)
          if (!b) {
            b = [rand(), rand(), rand()]
            blocks.set(key, b)
          }
          c = b
        }
      }
      const o = (y * width + x) * 3
      out[o] = q(c[0])
      out[o + 1] = q(c[1])
      out[o + 2] = q(c[2])
    }
  }
  return out
}

export function chartTiff(width = CHART_W, height = CHART_H): Uint8Array {
  return writeTiff16(width, height, generateChart(width, height))
}

/** El chart como imagen float, exactamente como la leería el decodificador (u16 / 65535). */
export function chartImage(width = CHART_W, height = CHART_H): FloatImage {
  const u = generateChart(width, height)
  const data = new Float32Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = u[i * 3] / U16
    data[i * 4 + 1] = u[i * 3 + 1] / U16
    data[i * 4 + 2] = u[i * 3 + 2] / U16
    data[i * 4 + 3] = 1
  }
  return { width, height, data, bitDepth: 16, format: 'TIFF', hasICC: false, warnings: [], name: 'lut-studio-chart.tif' }
}
