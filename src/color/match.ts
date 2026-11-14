/**
 * Etapa "Match": acerca el look de los frames al de una imagen de referencia. Va al comienzo de la etapa creativa
 * (después de la conversión), en Oklab, y es una función de color a color suave, así que entra en el LUT.
 *
 * - Luminancia: curva monótona (spline PCHIP de pocos nudos, pendientes acotadas) que lleva los cuantiles de L de
 *   los frames a los de la referencia. Pocos nudos y pendientes entre MIN_SLOPE y MAX_SLOPE: sin escalones.
 * - Color: en cada banda tonal (sombras, medios, altas, con los mismos pesos suaves que la saturación por rango) un
 *   mapa afín de (a, b) que lleva la media y la covarianza de los frames a las de la referencia (transporte óptimo
 *   lineal de Monge-Kantorovich). Los mapas se mezclan según L: sombras y altas pueden tener tintes distintos.
 * - Intensidad 0..1 y "proteger piel": cerca del tono de piel (eje I de YIQ, el de la línea del vectorscopio) el
 *   efecto se reduce, con transiciones suaves en tono y croma.
 *
 * Referencia en CPU; gpu/matchGlsl.ts replica cada operación y el test CPU vs GPU cubre las dos.
 */
import { decode24, encode24, tonalWeights } from './grade'
import { linearToOklab, oklabToLinear } from './oklab'
import { yiqIAxis } from './vectors'

export const MATCH_KNOTS = 9
/** cuantiles de L que se usan como nudos de la curva */
const QUANTILES = [0.01, 0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 0.95, 0.99]
export const MIN_SLOPE = 0.3
export const MAX_SLOPE = 3
/** autovalores de la transformación de (a, b): entre 1/MAX_AB_GAIN y MAX_AB_GAIN */
export const MAX_AB_GAIN = 2.5
/** regularización de la covarianza de (a, b) (≈ 0.012² en unidades de Oklab) */
const COV_EPS = 1.5e-4
/** reducción del efecto en el tono de piel con "proteger piel" */
export const SKIN_PROTECT = 0.85

export interface MatchBand {
  /** matriz 2x2 por filas */
  A: [number, number, number, number]
  t: [number, number]
}

export interface MatchModel {
  curve: { x: number[]; y: number[] }
  bands: [MatchBand, MatchBand, MatchBand]
  info: { reference: string; frames: number; samples: number }
}

export interface MatchParams {
  enabled: boolean
  /** 0..1 */
  intensity: number
  protectSkin: boolean
  model: MatchModel | null
}

export const defaultMatch = (): MatchParams => ({ enabled: true, intensity: 1, protectSkin: false, model: null })

// ---------------------------------------------------------------------------------------------------------------
// Spline monótona con pendientes explícitas (Fritsch-Carlson) y extrapolación lineal

export function pchipSlopes(x: readonly number[], y: readonly number[]): number[] {
  const n = x.length
  const d = Array.from({ length: n - 1 }, (_, i) => (y[i + 1] - y[i]) / (x[i + 1] - x[i]))
  const m = new Array<number>(n)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0
    else {
      const h0 = x[i] - x[i - 1]
      const h1 = x[i + 1] - x[i]
      const w1 = 2 * h1 + h0
      const w2 = h1 + 2 * h0
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    }
  }
  return m
}

export function evalHermite(x: readonly number[], y: readonly number[], m: readonly number[], n: number, v: number): number {
  if (v <= x[0]) return y[0] + (v - x[0]) * m[0]
  if (v >= x[n - 1]) return y[n - 1] + (v - x[n - 1]) * m[n - 1]
  let i = 0
  while (i < n - 2 && v > x[i + 1]) i++
  const h = x[i + 1] - x[i]
  const t = (v - x[i]) / h
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1]
}

// ---------------------------------------------------------------------------------------------------------------
// Estadísticas

/** Muestras RGB (Rec.709 γ2.4, intercaladas) -> Oklab (L, a, b intercalados). */
export function toOklab(rgb: Float32Array): Float32Array {
  const out = new Float32Array(rgb.length)
  for (let i = 0; i < rgb.length; i += 3) {
    const [L, a, b] = linearToOklab(decode24(rgb[i]), decode24(rgb[i + 1]), decode24(rgb[i + 2]))
    out[i] = L
    out[i + 1] = a
    out[i + 2] = b
  }
  return out
}

function quantiles(values: Float32Array, ps: readonly number[]): number[] {
  const s = Float32Array.from(values).sort()
  return ps.map((p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))])
}

/** Curva de L: cuantiles de origen -> cuantiles de referencia, regularizada (monótona, pendientes acotadas). */
export function luminanceCurve(srcL: Float32Array, refL: Float32Array): { x: number[]; y: number[] } {
  const qs = quantiles(srcL, QUANTILES)
  const qr = quantiles(refL, QUANTILES)
  // nudos con x estrictamente creciente (separados al menos 0.02)
  const x: number[] = []
  const y: number[] = []
  for (let i = 0; i < qs.length; i++) {
    if (x.length && qs[i] - x[x.length - 1] < 0.02) continue
    x.push(qs[i])
    y.push(qr[i])
  }
  if (x.length < 2) return { x: [0, 1], y: [0, 1] }
  // pendientes acotadas, desde el nudo central hacia afuera (el central queda en su lugar)
  const mid = Math.floor(x.length / 2)
  for (let i = mid + 1; i < x.length; i++) {
    const s = (y[i] - y[i - 1]) / (x[i] - x[i - 1])
    y[i] = y[i - 1] + Math.min(MAX_SLOPE, Math.max(MIN_SLOPE, s)) * (x[i] - x[i - 1])
  }
  for (let i = mid - 1; i >= 0; i--) {
    const s = (y[i + 1] - y[i]) / (x[i + 1] - x[i])
    y[i] = y[i + 1] - Math.min(MAX_SLOPE, Math.max(MIN_SLOPE, s)) * (x[i + 1] - x[i])
  }
  return { x, y }
}

type Sym2 = [number, number, number] // [xx, xy, yy]

function eig2(s: Sym2): { l: [number, number]; v: [number, number] } {
  const [a, b, c] = s
  const tr = (a + c) / 2
  const det = Math.sqrt(Math.max(0, ((a - c) / 2) ** 2 + b * b))
  const l1 = tr + det
  const l2 = tr - det
  // autovector de l1
  let v: [number, number] = Math.abs(b) > 1e-14 ? [l1 - c, b] : a >= c ? [1, 0] : [0, 1]
  const n = Math.hypot(v[0], v[1])
  v = [v[0] / n, v[1] / n]
  return { l: [l1, l2], v }
}

/** f(S) para una matriz simétrica 2x2, aplicando f a los autovalores. */
function symFn(s: Sym2, f: (x: number) => number): Sym2 {
  const { l, v } = eig2(s)
  const [p, q] = v // segundo autovector: (-q, p)
  const f1 = f(l[0])
  const f2 = f(l[1])
  return [f1 * p * p + f2 * q * q, (f1 - f2) * p * q, f1 * q * q + f2 * p * p]
}

/** producto de una 2x2 general (por filas) por una simétrica */
const mul22 = (a: [number, number, number, number], b: Sym2): [number, number, number, number] => [
  a[0] * b[0] + a[1] * b[1],
  a[0] * b[1] + a[1] * b[2],
  a[2] * b[0] + a[3] * b[1],
  a[2] * b[1] + a[3] * b[2],
]

const mulSym = (a: Sym2, b: Sym2): [number, number, number, number] => [
  a[0] * b[0] + a[1] * b[1],
  a[0] * b[1] + a[1] * b[2],
  a[1] * b[0] + a[2] * b[1],
  a[1] * b[1] + a[2] * b[2],
]

/** Transporte óptimo lineal entre dos gaussianas: T = Σs^-1/2 (Σs^1/2 Σr Σs^1/2)^1/2 Σs^-1/2 (simétrica). */
export function mongeKantorovich(cs: Sym2, cr: Sym2): Sym2 {
  const sh = symFn(cs, Math.sqrt)
  const shi = symFn(cs, (x) => 1 / Math.sqrt(x))
  // Σs^1/2 Σr Σs^1/2 (simétrica): producto completo, sin simetrizar pasos intermedios
  const m = mul22(mulSym(sh, cr), sh)
  const inner = m
  const innerSym: Sym2 = [inner[0], (inner[1] + inner[2]) / 2, inner[3]]
  const root = symFn(innerSym, (x) => Math.sqrt(Math.max(0, x)))
  const t = mul22(mulSym(shi, root), shi)
  // T es simétrica en exactitud; se simetriza para limpiar el redondeo y se acotan sus autovalores
  const T: Sym2 = [t[0], (t[1] + t[2]) / 2, t[3]]
  return symFn(T, (x) => Math.min(MAX_AB_GAIN, Math.max(1 / MAX_AB_GAIN, x)))
}

interface Stats {
  w: number
  mean: [number, number]
  cov: Sym2
}

function bandStats(lab: Float32Array, band: number): Stats {
  let w = 0
  let ma = 0
  let mb = 0
  for (let i = 0; i < lab.length; i += 3) {
    const k = tonalWeights(lab[i])[band]
    w += k
    ma += k * lab[i + 1]
    mb += k * lab[i + 2]
  }
  if (w <= 0) return { w: 0, mean: [0, 0], cov: [COV_EPS, 0, COV_EPS] }
  ma /= w
  mb /= w
  let xx = 0
  let xy = 0
  let yy = 0
  for (let i = 0; i < lab.length; i += 3) {
    const k = tonalWeights(lab[i])[band]
    const da = lab[i + 1] - ma
    const db = lab[i + 2] - mb
    xx += k * da * da
    xy += k * da * db
    yy += k * db * db
  }
  return { w, mean: [ma, mb], cov: [xx / w + COV_EPS, xy / w, yy / w + COV_EPS] }
}

function globalStats(lab: Float32Array): Stats {
  const n = lab.length / 3
  let ma = 0
  let mb = 0
  for (let i = 0; i < lab.length; i += 3) {
    ma += lab[i + 1]
    mb += lab[i + 2]
  }
  ma /= n
  mb /= n
  let xx = 0
  let xy = 0
  let yy = 0
  for (let i = 0; i < lab.length; i += 3) {
    const da = lab[i + 1] - ma
    const db = lab[i + 2] - mb
    xx += da * da
    xy += da * db
    yy += db * db
  }
  return { w: n, mean: [ma, mb], cov: [xx / n + COV_EPS, xy / n, yy / n + COV_EPS] }
}

/** Modelo de match a partir de muestras Rec.709 γ2.4 (RGB intercalado) de los frames y de la referencia. */
export function computeMatchModel(src: Float32Array, ref: Float32Array, info: Omit<MatchModel['info'], 'samples'>): MatchModel {
  if (src.length < 30 || ref.length < 30) throw new Error('Faltan muestras para calcular el match.')
  const s = toOklab(src)
  const r = toOklab(ref)
  const L = (lab: Float32Array) => lab.filter((_, i) => i % 3 === 0)
  const curve = luminanceCurve(L(s), L(r))
  const gs = globalStats(s)
  const gr = globalStats(r)
  const minW = 0.02
  const bands = [0, 1, 2].map((k) => {
    let bs = bandStats(s, k)
    let br = bandStats(r, k)
    // bandas casi vacías: se usan las estadísticas globales
    if (bs.w < minW * gs.w) bs = gs
    if (br.w < minW * gr.w) br = gr
    const T = mongeKantorovich(bs.cov, br.cov)
    const A: MatchBand['A'] = [T[0], T[1], T[1], T[2]]
    const t: MatchBand['t'] = [br.mean[0] - (A[0] * bs.mean[0] + A[1] * bs.mean[1]), br.mean[1] - (A[2] * bs.mean[0] + A[3] * bs.mean[1])]
    return { A, t }
  }) as MatchModel['bands']
  return { curve, bands, info: { ...info, samples: src.length / 3 } }
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluación

export interface PreparedMatch {
  k: number
  /** reducción en el tono de piel (0 = sin protección) */
  protect: number
  n: number
  x: number[]
  y: number[]
  m: number[]
  /** 3 bandas x 4 (matrices por filas) */
  A: number[]
  /** 3 bandas x 2 */
  t: number[]
  /** dirección del tono de piel en (a, b), unitaria */
  skin: [number, number]
}

/** Tono de piel en Oklab: el eje I de YIQ desde un gris medio (la misma referencia que el vectorscopio). */
export const SKIN_AB: [number, number] = (() => {
  const d = yiqIAxis()
  const lab = linearToOklab(decode24(0.5 + 0.3 * d[0]), decode24(0.5 + 0.3 * d[1]), decode24(0.5 + 0.3 * d[2]))
  const n = Math.hypot(lab[1], lab[2])
  return [lab[1] / n, lab[2] / n]
})()

/** Modelo válido (por ejemplo, de un proyecto): nudos crecientes, números finitos. */
function validModel(m: MatchModel | null): m is MatchModel {
  if (!m || !m.curve || !Array.isArray(m.curve.x) || !Array.isArray(m.curve.y) || !Array.isArray(m.bands)) return false
  const { x, y } = m.curve
  if (x.length < 2 || x.length > MATCH_KNOTS || x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i]) || !Number.isFinite(y[i]) || (i && x[i] <= x[i - 1])) return false
  return m.bands.length === 3 && m.bands.every((b) => b.A?.length === 4 && b.t?.length === 2 && [...b.A, ...b.t].every(Number.isFinite))
}

export function prepareMatch(p: MatchParams | undefined): PreparedMatch | null {
  if (!p || !p.enabled || !(p.intensity > 0) || !validModel(p.model)) return null
  const { x, y } = p.model.curve
  const m = pchipSlopes(x, y)
  const pad = (a: number[]) => [...a, ...new Array(MATCH_KNOTS - a.length).fill(a[a.length - 1])]
  return {
    k: Math.min(1, p.intensity),
    protect: p.protectSkin ? SKIN_PROTECT : 0,
    n: x.length,
    x: pad(x),
    y: pad(y),
    m: pad(m),
    A: p.model.bands.flatMap((b) => b.A),
    t: p.model.bands.flatMap((b) => b.t),
    skin: SKIN_AB,
  }
}

const smoothstep = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Peso del tono de piel (0..1): suave en el ángulo (±15° pleno, 45° nada) y en la croma. */
export function skinWeight(a: number, b: number, skin: readonly [number, number]): number {
  const C = Math.hypot(a, b)
  if (C < 1e-6) return 0
  const cosd = (a * skin[0] + b * skin[1]) / C
  return smoothstep(0.7071067811865476, 0.9659258262890683, cosd) * smoothstep(0.015, 0.05, C)
}

/** Aplica el match a `c` (Rec.709 γ2.4). Modifica y devuelve `c`. */
export function evalMatch(pm: PreparedMatch, c: [number, number, number]): [number, number, number] {
  const [L, a, b] = linearToOklab(decode24(c[0]), decode24(c[1]), decode24(c[2]))
  const w = tonalWeights(L)
  const A = [0, 0, 0, 0]
  const t = [0, 0]
  for (let k = 0; k < 3; k++) {
    for (let j = 0; j < 4; j++) A[j] += w[k] * pm.A[k * 4 + j]
    t[0] += w[k] * pm.t[k * 2]
    t[1] += w[k] * pm.t[k * 2 + 1]
  }
  const L2 = evalHermite(pm.x, pm.y, pm.m, pm.n, L)
  const a2 = A[0] * a + A[1] * b + t[0]
  const b2 = A[2] * a + A[3] * b + t[1]
  const k = pm.protect > 0 ? pm.k * (1 - pm.protect * skinWeight(a, b, pm.skin)) : pm.k
  const lin = oklabToLinear(L + (L2 - L) * k, a + (a2 - a) * k, b + (b2 - b) * k)
  c[0] = encode24(lin[0])
  c[1] = encode24(lin[1])
  c[2] = encode24(lin[2])
  return c
}
