/**
 * Curvas por puntos de control con interpolación cúbica monótona (Fritsch-Carlson / PCHIP):
 * pasa por todos los puntos y nunca hace overshoot entre dos puntos consecutivos.
 */
import type { Pt } from './params'

function sortDedupe(points: readonly Pt[]): Pt[] {
  const pts = points.slice().sort((a, b) => a.x - b.x)
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < 1e-9) last.y = p.y
    else out.push({ x: p.x, y: p.y })
  }
  return out
}

/** Devuelve un evaluador de la curva. Fuera del rango de los puntos, extiende con el valor del extremo. */
export function monotoneSpline(points: readonly Pt[]): (x: number) => number {
  const pts = sortDedupe(points)
  const n = pts.length
  if (n === 0) return () => 0
  if (n === 1) return () => pts[0].y
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const h: number[] = []
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i])
    d.push((ys[i + 1] - ys[i]) / h[i])
  }
  // pendientes en los nodos (media armónica ponderada; 0 en extremos locales => sin overshoot)
  const m = new Array<number>(n).fill(0)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0
    else {
      const w1 = 2 * h[i] + h[i - 1]
      const w2 = h[i] + 2 * h[i - 1]
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    }
  }
  // limitar las pendientes de los extremos para conservar la monotonía
  for (const [i, k] of [
    [0, 0],
    [n - 1, n - 2],
  ] as const) {
    if (d[k] === 0) m[i] = 0
    else if (m[i] / d[k] > 3) m[i] = 3 * d[k]
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (xs[mid] <= x) lo = mid
      else hi = mid
    }
    const t = (x - xs[lo]) / h[lo]
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h[lo] * m[lo] + (-2 * t3 + 3 * t2) * ys[lo + 1] + (t3 - t2) * h[lo] * m[lo + 1]
    )
  }
}

/** Igual que monotoneSpline pero periódica en x con período 1 (para curvas por tono). */
export function periodicSpline(points: readonly Pt[]): (x: number) => number {
  const pts = sortDedupe(points.map((p) => ({ x: p.x - Math.floor(p.x), y: p.y })))
  if (pts.length === 0) return () => 0
  if (pts.length === 1) return () => pts[0].y
  const ext: Pt[] = []
  for (const k of [-1, 0, 1]) for (const p of pts) ext.push({ x: p.x + k, y: p.y })
  const f = monotoneSpline(ext)
  return (x: number) => f(x - Math.floor(x))
}

export const isIdentityCurve = (points: readonly Pt[]): boolean =>
  points.length >= 2 && points.every((p) => Math.abs(p.x - p.y) < 1e-12)

export const isFlatCurve = (points: readonly Pt[]): boolean => points.every((p) => p.y === 0)
