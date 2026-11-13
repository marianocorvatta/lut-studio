/** Utilidades compartidas por los tests de GPU (corren en navegador). */
import { identityLut3D, type Lut3D } from '../color/lut'

export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** LUT suave pero no trivial (no afín), con valores fuera de [0,1] para probar que no hay clamp intermedio. */
export function wavyLut(size: number, seed: number, amount = 0.25): Lut3D {
  const lut = identityLut3D(size)
  const rand = rng(seed)
  const k = Array.from({ length: 12 }, () => rand() * 5 + 1)
  const d = lut.data
  for (let i = 0; i < d.length; i += 3) {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    d[i] = r + amount * Math.sin(k[0] * r + k[1] * g + k[2] * b + k[3])
    d[i + 1] = g + amount * Math.sin(k[4] * r + k[5] * g + k[6] * b + k[7]) * r
    d[i + 2] = b * b + amount * Math.cos(k[8] * r + k[9] * g + k[10] * b + k[11])
  }
  return lut
}

export interface Diff {
  max: number
  mean: number
}

export function diff(a: ArrayLike<number>, b: ArrayLike<number>): Diff {
  if (a.length !== b.length) throw new Error(`longitudes distintas: ${a.length} vs ${b.length}`)
  let max = 0
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    if (!(d <= max)) max = Number.isNaN(d) ? Infinity : d
    sum += d
  }
  return { max, mean: sum / a.length }
}

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const dpr = window.devicePixelRatio || 1
  canvas.style.width = `${width / dpr}px`
  canvas.style.height = `${height / dpr}px`
  canvas.style.display = 'block'
  document.body.appendChild(canvas)
  return canvas
}
