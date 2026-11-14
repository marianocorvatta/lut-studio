/**
 * Diagnóstico de un LUT 3D horneado (antes del clamp final): lo que después aparecería como artefactos.
 *
 * - Quiebres: en cada nodo, eje y canal se predice el valor con la cúbica que pasa por los nodos ±1 y ±2 del
 *   mismo eje, (-L[i-2] + 4 L[i-1] + 4 L[i+1] - L[i+2]) / 6. La cúbica absorbe la curvatura normal de un LUT
 *   suave; un pico deja un residuo igual a su tamaño y un salto, la mitad. Un nodo es un quiebre si su residuo
 *   supera `breakK` veces la mediana de los residuos del mismo eje y canal en los nodos a distancia 3 a 5 (fuera
 *   del alcance del propio pico) y además un piso absoluto (para no marcar el ruido de float32 en zonas lineales).
 *   No se evalúa donde algún nodo del predictor sale de 0..1 (ahí manda el recorte) ni por debajo del código 0.06,
 *   donde la codificación γ2.4 tiene pendiente casi infinita.
 * - Inversiones: la luminancia de salida (lineal: Rec.709 γ2.4 decodificada y recortada a 0..1) tiene que ser monótona a lo largo de cada línea de la grilla
 *   (en la dirección general de la línea: con gamuts amplios, subir un canal de entrada puede bajar la
 *   luminancia en toda la línea, y eso no es una inversión) y creciente a lo largo del eje de grises.
 *   Se marca cada tramo que va en contra más de `inversionTol`.
 * - Recorte: nodos con algún canal por debajo de 0 o por encima de 1.
 *
 * Una celda tiene un problema si alguno de sus 8 nodos lo tiene (todos intervienen en la interpolación de los
 * colores de esa celda). Lógica pura: corre en un worker.
 *
 * En el Estudio, quiebres e inversiones se buscan en el LUT del look solo (Rec.709 -> Rec.709): la conversión
 * log -> Rec.709 tiene estructura propia (rodillas, gamut amplio donde subir B baja la luminancia) que no son
 * artefactos, y en espacio de display sí vale que la luminancia crezca con cada canal. El recorte se busca en
 * el LUT completo.
 */
import type { Lut3D } from './lut'

export const FLAG_BREAK = 1
export const FLAG_INVERSION = 2
export const FLAG_CLIP_LOW = 4
export const FLAG_CLIP_HIGH = 8
const TYPES = [FLAG_BREAK, FLAG_INVERSION, FLAG_CLIP_LOW, FLAG_CLIP_HIGH] as const

export interface AnalyzeOptions {
  /** cuántas veces la mediana local tiene que superar el residuo para marcar un quiebre */
  breakK: number
  /** residuo mínimo para considerar un quiebre (valores de código; 0.008 ≈ 8 códigos de 10 bits) */
  breakFloor: number
  /** caída de luminancia tolerada entre nodos vecinos (valores de código) */
  inversionTol: number
}

export const DEFAULT_ANALYZE: AnalyzeOptions = { breakK: 6, breakFloor: 0.008, inversionTol: 0.005 }

export interface CellCounts {
  breakCells: number
  inversionCells: number
  clipLowCells: number
  clipHighCells: number
}

export interface LutDiagnostics extends CellCounts {
  size: number
  /** bits FLAG_* por nodo, en el orden del .cube (r más rápido) */
  nodeFlags: Uint8Array
  cells: number
  /** tramos del eje de grises donde la luminancia baja */
  grayInversions: number
  /** peor caída de luminancia encontrada (0 si no hay) */
  worstInversion: number
  /** mayor residuo de quiebre encontrado (0 si no hay) */
  worstBreak: number
}

const LUMA = [0.2126, 0.7152, 0.0722]
const REF_NEAR = 3
const REF_FAR = 5
/** debajo de este código no se buscan quiebres (toe de la codificación γ2.4 del pipeline, ≈ 0.056) */
const NEAR_BLACK = 0.06

function median(a: Float32Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const v = a[i]
    let j = i - 1
    while (j >= 0 && a[j] > v) {
      a[j + 1] = a[j]
      j--
    }
    a[j + 1] = v
  }
  return n % 2 ? a[(n - 1) >> 1] : 0.5 * (a[n / 2 - 1] + a[n / 2])
}

/** Bits de los 8 nodos de cada celda, OR. */
export function cellFlags(flags: Uint8Array, n: number): Uint8Array {
  const m = n - 1
  const out = new Uint8Array(m * m * m)
  for (let b = 0; b < m; b++)
    for (let g = 0; g < m; g++)
      for (let r = 0; r < m; r++) {
        const i = r + n * (g + n * b)
        out[r + m * (g + m * b)] =
          flags[i] |
          flags[i + 1] |
          flags[i + n] |
          flags[i + n + 1] |
          flags[i + n * n] |
          flags[i + n * n + 1] |
          flags[i + n * n + n] |
          flags[i + n * n + n + 1]
      }
  return out
}

export function countCells(flags: Uint8Array, n: number): CellCounts {
  const cells = cellFlags(flags, n)
  const c = [0, 0, 0, 0]
  for (let i = 0; i < cells.length; i++) for (let t = 0; t < 4; t++) if (cells[i] & TYPES[t]) c[t]++
  return { breakCells: c[0], inversionCells: c[1], clipLowCells: c[2], clipHighCells: c[3] }
}

export function analyzeLut(lut: Lut3D, opts: AnalyzeOptions = DEFAULT_ANALYZE): LutDiagnostics {
  const n = lut.size
  const d = lut.data
  const N3 = n * n * n
  const stride = [1, n, n * n]
  const flags = new Uint8Array(N3)
  const coordOf = (i: number, a: number) => (a === 0 ? i % n : a === 1 ? Math.floor(i / n) % n : Math.floor(i / (n * n)))

  // residuo de la predicción cúbica por nodo, eje y canal (-1: fuera del alcance del predictor)
  const res = new Float32Array(N3 * 9).fill(-1)
  for (let i = 0; i < N3; i++)
    for (let a = 0; a < 3; a++) {
      const k = coordOf(i, a)
      if (k < 2 || k > n - 3) continue
      const s = stride[a]
      for (let c = 0; c < 3; c++) {
        const q = [d[(i - 2 * s) * 3 + c], d[(i - s) * 3 + c], d[i * 3 + c], d[(i + s) * 3 + c], d[(i + 2 * s) * 3 + c]]
        // donde algún nodo sale de 0..1 manda el recorte (tiene su propia alerta y el clamp lo aplana); cerca del
        // negro la codificación γ2.4 tiene pendiente casi infinita y su curvatura es legítima
        if (q.some((v) => v < NEAR_BLACK || v >= 1)) continue
        res[i * 9 + a * 3 + c] = Math.abs(q[2] - (-q[0] + 4 * q[1] + 4 * q[3] - q[4]) / 6)
      }
    }

  // quiebres: contra la mediana de los residuos del mismo eje y canal a distancia REF_NEAR..REF_FAR (fuera del
  // alcance de un pico o un salto en este nodo, que se reparte en los nodos ±2)
  const win = new Float32Array(2 * (REF_FAR - REF_NEAR + 1))
  let worstBreak = 0
  for (let i = 0; i < N3; i++)
    for (let a = 0; a < 3; a++) {
      const k = coordOf(i, a)
      for (let c = 0; c < 3; c++) {
        const v = res[i * 9 + a * 3 + c]
        if (v <= opts.breakFloor) continue
        let m = 0
        for (let t = REF_NEAR; t <= REF_FAR; t++)
          for (const sg of [-1, 1]) {
            const kk = k + sg * t
            if (kk < 2 || kk > n - 3) continue
            const rv = res[(i + sg * t * stride[a]) * 9 + a * 3 + c]
            if (rv >= 0) win[m++] = rv
          }
        const med = m ? median(win, m) : 0
        if (v > opts.breakK * med) {
          flags[i] |= FLAG_BREAK
          worstBreak = Math.max(worstBreak, v)
        }
      }
    }

  // inversiones de luminancia lineal (Rec.709 γ2.4 -> lineal), sobre la salida recortada a 0..1 como la verá DaVinci
  const Y = new Float32Array(N3)
  const lin = (v: number) => Math.min(1, Math.max(0, v)) ** 2.4
  for (let i = 0; i < N3; i++) Y[i] = LUMA[0] * lin(d[i * 3]) + LUMA[1] * lin(d[i * 3 + 1]) + LUMA[2] * lin(d[i * 3 + 2])
  let worstInversion = 0
  const mark = (i: number, j: number, against: number) => {
    if (against <= opts.inversionTol) return false
    flags[i] |= FLAG_INVERSION
    flags[j] |= FLAG_INVERSION
    worstInversion = Math.max(worstInversion, against)
    return true
  }
  for (let a = 0; a < 3; a++) {
    const s = stride[a]
    for (let i0 = 0; i0 < N3; i0++) {
      if (coordOf(i0, a) !== 0) continue
      const dir = Y[i0 + (n - 1) * s] >= Y[i0] ? 1 : -1
      for (let k = 0; k < n - 1; k++) {
        const i = i0 + k * s
        mark(i, i + s, -dir * (Y[i + s] - Y[i]))
      }
    }
  }
  let grayInversions = 0
  const diag = 1 + n + n * n
  for (let k = 0; k < n - 1; k++) if (mark(k * diag, (k + 1) * diag, Y[k * diag] - Y[(k + 1) * diag])) grayInversions++

  // recorte
  for (let i = 0; i < N3; i++)
    for (let c = 0; c < 3; c++) {
      const v = d[i * 3 + c]
      if (v < 0) flags[i] |= FLAG_CLIP_LOW
      else if (v > 1) flags[i] |= FLAG_CLIP_HIGH
    }

  return {
    size: n,
    nodeFlags: flags,
    cells: (n - 1) ** 3,
    ...countCells(flags, n),
    grayInversions,
    worstInversion,
    worstBreak,
  }
}

export interface PixelStats {
  samples: number
  /** fracción de píxeles cuyos colores caen en celdas con cada problema */
  break: number
  inversion: number
  clipLow: number
  clipHigh: number
}

/** Qué fracción de los píxeles (RGB intercalado, en el dominio 0..1 del LUT) cae en celdas con problemas. */
export function pixelStats(flags: Uint8Array, n: number, pixels: Float32Array): PixelStats {
  const cells = cellFlags(flags, n)
  const m = n - 1
  const count = pixels.length / 3
  const c = [0, 0, 0, 0]
  const cell = (v: number) => Math.min(m - 1, Math.max(0, Math.floor(v * m)))
  for (let p = 0; p < count; p++) {
    const f = cells[cell(pixels[p * 3]) + m * (cell(pixels[p * 3 + 1]) + m * cell(pixels[p * 3 + 2]))]
    if (!f) continue
    for (let t = 0; t < 4; t++) if (f & TYPES[t]) c[t]++
  }
  const k = count ? 1 / count : 0
  return { samples: count, break: c[0] * k, inversion: c[1] * k, clipLow: c[2] * k, clipHigh: c[3] * k }
}
