import { describe, expect, it } from 'vitest'
import { decode24, encode24 } from './grade'
import {
  computeMatchModel,
  evalHermite,
  evalMatch,
  luminanceCurve,
  MAX_SLOPE,
  MIN_SLOPE,
  mongeKantorovich,
  pchipSlopes,
  prepareMatch,
  SKIN_AB,
  toOklab,
  type MatchModel,
} from './match'
import { linearToOklab, oklabToLinear } from './oklab'
import { defaultParams } from './params'
import { bakeCpu, evalPipeline, prepare } from './pipeline'

let seed = 12345
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)

/** "Frames" sintéticos: Rec.709 γ2.4 con tonos de piel, cielo, verdes y neutros a distintas luminancias. */
function sampleImage(n: number): Float32Array {
  const out = new Float32Array(n * 3)
  const bases = [
    [0.75, 0.55, 0.45],
    [0.35, 0.55, 0.8],
    [0.3, 0.5, 0.25],
    [0.5, 0.5, 0.5],
    [0.15, 0.12, 0.1],
    [0.9, 0.88, 0.85],
  ]
  for (let i = 0; i < n; i++) {
    const b = bases[Math.floor(rnd() * bases.length)]
    const k = 0.4 + rnd() * 0.9
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.min(1, Math.max(0, b[c] * k + (rnd() - 0.5) * 0.08))
  }
  return out
}

/** Aplica una función en Oklab a cada muestra. */
function mapOklab(rgb: Float32Array, f: (L: number, a: number, b: number) => [number, number, number]): Float32Array {
  const out = new Float32Array(rgb.length)
  for (let i = 0; i < rgb.length; i += 3) {
    const [L, a, b] = linearToOklab(decode24(rgb[i]), decode24(rgb[i + 1]), decode24(rgb[i + 2]))
    const lin = oklabToLinear(...f(L, a, b))
    for (let c = 0; c < 3; c++) out[i + c] = encode24(lin[c])
  }
  return out
}

function applyModel(model: MatchModel, rgb: Float32Array, intensity = 1, protectSkin = false): Float32Array {
  const pm = prepareMatch({ enabled: true, intensity, protectSkin, model })!
  const out = new Float32Array(rgb.length)
  for (let i = 0; i < rgb.length; i += 3) {
    const c: [number, number, number] = [rgb[i], rgb[i + 1], rgb[i + 2]]
    evalMatch(pm, c)
    out.set(c, i)
  }
  return out
}

const info = { reference: 'ref', frames: 1 }

describe('match con una imagen de referencia', () => {
  it('misma imagen como origen y referencia: casi identidad', () => {
    const src = sampleImage(20000)
    const model = computeMatchModel(src, src, info)
    const out = applyModel(model, src)
    let max = 0
    for (let i = 0; i < src.length; i++) max = Math.max(max, Math.abs(out[i] - src[i]))
    expect(max).toBeLessThan(1e-5)
    for (const b of model.bands) {
      expect(b.A[0]).toBeCloseTo(1, 6)
      expect(b.A[1]).toBeCloseTo(0, 6)
      expect(b.A[3]).toBeCloseTo(1, 6)
      expect(Math.hypot(...b.t)).toBeLessThan(1e-7)
    }
  })

  it('referencia con un tinte conocido en (a, b): el match lo reproduce', () => {
    const src = sampleImage(20000)
    const ref = mapOklab(src, (L, a, b) => [L, a + 0.03, b - 0.02])
    const out = applyModel(computeMatchModel(src, ref, info), src)
    const ls = toOklab(src)
    const lo = toOklab(out)
    let da = 0
    let db = 0
    const n = ls.length / 3
    for (let i = 0; i < ls.length; i += 3) {
      da += lo[i + 1] - ls[i + 1]
      db += lo[i + 2] - ls[i + 2]
    }
    expect(da / n).toBeCloseTo(0.03, 3)
    expect(db / n).toBeCloseTo(-0.02, 3)
  })

  it('referencia con un tinte en RGB y más contraste: el resultado se acerca a la referencia', () => {
    const src = sampleImage(20000)
    // tinte cálido en lineal y curva de contraste en L
    const ref = new Float32Array(src.length)
    for (let i = 0; i < src.length; i += 3) {
      const gain = [1.12, 1.0, 0.85]
      for (let c = 0; c < 3; c++) ref[i + c] = encode24(decode24(src[i + c]) * gain[c])
    }
    const ref2 = mapOklab(ref, (L, a, b) => [0.5 + (L - 0.5) * 1.2, a, b])
    const out = applyModel(computeMatchModel(src, ref2, info), src)
    // comparación por estadísticas (el match no es por píxel): media de a, b y L
    const mean = (x: Float32Array, k: number) => {
      const lab = toOklab(x)
      let s = 0
      for (let i = k; i < lab.length; i += 3) s += lab[i]
      return s / (lab.length / 3)
    }
    for (const k of [0, 1, 2]) {
      const before = Math.abs(mean(src, k) - mean(ref2, k))
      const after = Math.abs(mean(out, k) - mean(ref2, k))
      expect(after).toBeLessThan(Math.max(2e-3, before * 0.2))
    }
  })

  it('intensidad 0..1 interpola entre el original y el match completo', () => {
    const src = sampleImage(2000)
    const ref = mapOklab(src, (L, a, b) => [L * 0.9 + 0.05, a + 0.02, b + 0.01])
    const model = computeMatchModel(src, ref, info)
    const full = toOklab(applyModel(model, src))
    const half = toOklab(applyModel(model, src, 0.5))
    const orig = toOklab(src)
    for (let i = 0; i < 300; i++) expect(half[i]).toBeCloseTo((orig[i] + full[i]) / 2, 4)
  })

  it('la curva de luminancia es monótona, suave y con pendientes acotadas', () => {
    for (let trial = 0; trial < 20; trial++) {
      const n = 5000
      const s = new Float32Array(n)
      const r = new Float32Array(n)
      const p = 0.3 + rnd() * 3
      for (let i = 0; i < n; i++) {
        s[i] = rnd() ** (0.5 + rnd())
        r[i] = rnd() ** p * (0.6 + rnd() * 0.4)
      }
      const { x, y } = luminanceCurve(s, r)
      const m = pchipSlopes(x, y)
      let prev = -Infinity
      let prevSlope = NaN
      for (let v = -0.1; v <= 1.1; v += 0.001) {
        const f = evalHermite(x, y, m, x.length, v)
        expect(f).toBeGreaterThan(prev)
        const slope = (evalHermite(x, y, m, x.length, v + 1e-4) - f) / 1e-4
        if (!Number.isNaN(prevSlope)) expect(Math.abs(slope - prevSlope)).toBeLessThan(0.15) // sin escalones
        prevSlope = slope
        prev = f
      }
      for (let i = 1; i < x.length; i++) {
        const s1 = (y[i] - y[i - 1]) / (x[i] - x[i - 1])
        expect(s1).toBeGreaterThanOrEqual(MIN_SLOPE - 1e-9)
        expect(s1).toBeLessThanOrEqual(MAX_SLOPE + 1e-9)
      }
    }
  })

  it('transporte óptimo lineal: lleva la covarianza de origen a la de referencia', () => {
    const cs: [number, number, number] = [0.004, 0.001, 0.002]
    const cr: [number, number, number] = [0.003, -0.0005, 0.005]
    const [a, b, c] = mongeKantorovich(cs, cr)
    // T Σs T = Σr
    const S = [
      [cs[0], cs[1]],
      [cs[1], cs[2]],
    ]
    const T = [
      [a, b],
      [b, c],
    ]
    const mul = (X: number[][], Y: number[][]) => X.map((r) => [0, 1].map((j) => r[0] * Y[0][j] + r[1] * Y[1][j]))
    const R = mul(mul(T, S), T)
    expect(R[0][0]).toBeCloseTo(cr[0], 8)
    expect(R[0][1]).toBeCloseTo(cr[1], 8)
    expect(R[1][1]).toBeCloseTo(cr[2], 8)
  })

  it('proteger piel: el tono de piel cambia mucho menos que el opuesto', () => {
    const src = sampleImage(5000)
    const ref = mapOklab(src, (L, a, b) => [L, a - 0.04, b + 0.03])
    const model = computeMatchModel(src, ref, info)
    const pmOff = prepareMatch({ enabled: true, intensity: 1, protectSkin: false, model })!
    const pmOn = prepareMatch({ enabled: true, intensity: 1, protectSkin: true, model })!
    const at = (dir: number): [number, number, number] => {
      const lin = oklabToLinear(0.65, dir * 0.08 * SKIN_AB[0], dir * 0.08 * SKIN_AB[1])
      return [encode24(lin[0]), encode24(lin[1]), encode24(lin[2])]
    }
    const change = (pm: typeof pmOn, c: [number, number, number]) => {
      const o = evalMatch(pm, [...c] as [number, number, number])
      return Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2])
    }
    const skin = at(1)
    const opposite = at(-1)
    expect(change(pmOn, skin)).toBeLessThan(change(pmOff, skin) * 0.2)
    expect(change(pmOn, opposite)).toBeCloseTo(change(pmOff, opposite), 9)
  })

  it('en el pipeline: apagado o sin modelo no cambia nada; es una función suave de color a color', () => {
    const src = sampleImage(3000)
    const ref = mapOklab(src, (L, a, b) => [L * 0.95 + 0.03, a + 0.015, b + 0.01])
    const params = defaultParams()
    params.conversion.enabled = false
    const base = bakeCpu(prepare(params, { conversionLut: null, creativeLut: null }, 'tetrahedral'), 17)
    params.match.model = computeMatchModel(src, ref, info)
    params.match.enabled = false
    expect(bakeCpu(prepare(params, { conversionLut: null, creativeLut: null }, 'tetrahedral'), 17).data).toEqual(base.data)
    params.match.enabled = true
    const p = prepare(params, { conversionLut: null, creativeLut: null }, 'tetrahedral')
    // suavidad: pasos chicos de entrada dan pasos chicos de salida (sin saltos)
    for (let i = 0; i < 200; i++) {
      const x: [number, number, number] = [rnd(), rnd(), rnd()]
      const y: [number, number, number] = [x[0] + 1e-4, x[1] - 1e-4, x[2] + 1e-4]
      const fx = evalPipeline(p, [...x] as [number, number, number])
      const fy = evalPipeline(p, [...y] as [number, number, number])
      expect(Math.hypot(fx[0] - fy[0], fx[1] - fy[1], fx[2] - fy[2])).toBeLessThan(5e-3)
    }
  })
})
