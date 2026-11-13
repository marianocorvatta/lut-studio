/**
 * Etapa creativa (sobre Rec.709 gamma 2.4, estilo DaVinci). Referencia en CPU.
 * gpu/gradeGlsl.ts replica cada operación; el test CPU vs GPU cubre las dos.
 *
 * Orden: Lift/Gamma/Gain → Offset → Contraste (pivote) → Curvas RGB → etapa Oklab
 *        (saturación global y por rango tonal, curvas de tono, Lum vs Sat, split toning).
 *
 * Cada paso se salta si está en neutro, así el pipeline neutro es la identidad exacta.
 * Ningún paso recorta: las curvas extrapolan linealmente fuera de [0, 1].
 */
import { monotoneSpline, periodicSpline, isFlatCurve, isIdentityCurve } from './curves'
import { linearToOklab, oklabToLinear, sgnpow } from './oklab'
import type { LookParams, Wheel } from './params'

export const CURVE_N = 1024

/** Cb/Cr de la rueda -> dirección RGB sin cambio de luma (inversa de Y'CbCr Rec.709 con Y' = 0). */
export function wheelDir(w: Pick<Wheel, 'x' | 'y'>): [number, number, number] {
  const cb = w.x
  const cr = w.y
  return [1.5748 * cr, -0.1873 * cb - 0.4681 * cr, 1.8556 * cb]
}

const WHEEL_SCALE = { lift: 0.25, gamma: 0.5, gain: 0.5, offset: 0.25 } as const

export const HUE_ROTATE_MAX = 60 / 360 // vueltas
export const HUE_LUM_MAX = 0.3
export const SPLIT_CHROMA = 0.06

/**
 * Par gamma 2.4 interno de la etapa Oklab, con un tramo lineal en |lineal| < TOE_LIN (como el toe de sRGB).
 * x^(1/2.4) tiene pendiente infinita en 0: sin el tramo lineal, el redondeo de float32 cerca de cero
 * se amplifica sin límite. Es un par exactamente inverso, así que en neutro no cambia nada.
 */
export const TOE_LIN = 1e-3
export const TOE_CODE = TOE_LIN ** (1 / 2.4)
const TOE_SLOPE = TOE_LIN / TOE_CODE

export const decode24 = (c: number): number => (Math.abs(c) < TOE_CODE ? c * TOE_SLOPE : sgnpow(c, 2.4))
export const encode24 = (l: number): number => (Math.abs(l) < TOE_LIN ? l / TOE_SLOPE : sgnpow(l, 1 / 2.4))

/** seno y coseno por serie de Taylor, |d| <= pi/3 (misma fórmula en la GPU, que tiene trig imprecisa) */
export function sinCosSmall(d: number): [number, number] {
  const d2 = d * d
  const sin = d * (1 - (d2 / 6) * (1 - (d2 / 20) * (1 - (d2 / 42) * (1 - (d2 / 72) * (1 - d2 / 110)))))
  const cos = 1 - (d2 / 2) * (1 - (d2 / 12) * (1 - (d2 / 30) * (1 - (d2 / 56) * (1 - (d2 / 90) * (1 - d2 / 132)))))
  return [sin, cos]
}

export interface PreparedGrade {
  lggOn: boolean
  lift: [number, number, number]
  gain: [number, number, number]
  /** exponente por canal: 2^(-gamma) */
  gammaExp: [number, number, number]
  offsetOn: boolean
  offset: [number, number, number]
  contrastOn: boolean
  contrast: number
  pivot: number
  curvesOn: boolean
  /** activo por canal: [master, r, g, b] */
  curveMask: [boolean, boolean, boolean, boolean]
  okOn: boolean
  saturation: number
  tonalOn: boolean
  satShadows: number
  satMids: number
  satHighs: number
  hueMask: [boolean, boolean, boolean, boolean]
  splitOn: boolean
  /** desplazamientos a, b de sombras y altas */
  splitShadow: [number, number]
  splitHigh: [number, number]
  splitBalance: number
  /**
   * Tablas de CURVE_N muestras, 2 filas x RGBA (mismo formato que la textura de la GPU):
   * fila 0 = master, r, g, b (x en 0..1, muestras en i / (N - 1));
   * fila 1 = hueHue, hueSat, hueLum (periódicas, muestras en i / N), lumSat (muestras en i / (N - 1)).
   */
  table: Float32Array
}

export function prepareGrade(params: LookParams): PreparedGrade {
  const g = params.grade
  const dir = (w: Wheel, k: number) => wheelDir(w).map((d) => d * k) as [number, number, number]
  const dl = dir(g.lift, WHEEL_SCALE.lift)
  const dg = dir(g.gamma, WHEEL_SCALE.gamma)
  const dn = dir(g.gain, WHEEL_SCALE.gain)
  const doff = dir(g.offset, WHEEL_SCALE.offset)
  const lift = dl.map((d) => g.lift.master + d) as [number, number, number]
  const gain = dn.map((d) => g.gain.master + d) as [number, number, number]
  const gammaExp = dg.map((d) => 2 ** -(g.gamma.master + d)) as [number, number, number]
  const offset = doff.map((d) => g.offset.master + d) as [number, number, number]
  const lggOn = lift.some((v) => v !== 0) || gain.some((v) => v !== 1) || gammaExp.some((v) => v !== 1)

  const N = CURVE_N
  const table = new Float32Array(N * 2 * 4)
  const rgbNames = ['master', 'r', 'g', 'b'] as const
  const curveMask = rgbNames.map((k) => !isIdentityCurve(params.curves[k])) as PreparedGrade['curveMask']
  rgbNames.forEach((k, ch) => {
    const f = monotoneSpline(params.curves[k])
    for (let i = 0; i < N; i++) table[i * 4 + ch] = curveMask[ch] ? f(i / (N - 1)) : i / (N - 1)
  })
  const hueNames = ['hueHue', 'hueSat', 'hueLum', 'lumSat'] as const
  const hueMask = hueNames.map((k) => !isFlatCurve(params.hueCurves[k])) as PreparedGrade['hueMask']
  hueNames.forEach((k, ch) => {
    const pts = params.hueCurves[k]
    const f = k === 'lumSat' ? monotoneSpline(pts) : periodicSpline(pts)
    for (let i = 0; i < N; i++) {
      const x = k === 'lumSat' ? i / (N - 1) : i / N
      table[(N + i) * 4 + ch] = hueMask[ch] ? Math.max(-1, Math.min(1, f(x))) : 0
    }
  })

  const st = params.splitTone
  const ab = (hue: number, amount: number): [number, number] => {
    const t = (hue / 180) * Math.PI
    return [Math.cos(t) * amount * SPLIT_CHROMA, Math.sin(t) * amount * SPLIT_CHROMA]
  }
  const splitOn = st.shadowAmount !== 0 || st.highAmount !== 0
  const tonalOn = g.satShadows !== 1 || g.satMids !== 1 || g.satHighs !== 1
  const okOn = g.saturation !== 1 || tonalOn || hueMask.some(Boolean) || splitOn

  return {
    lggOn,
    lift,
    gain,
    gammaExp,
    offsetOn: offset.some((v) => v !== 0),
    offset,
    contrastOn: g.contrast !== 1,
    contrast: g.contrast,
    pivot: g.pivot,
    curvesOn: curveMask.some(Boolean),
    curveMask,
    okOn,
    saturation: g.saturation,
    tonalOn,
    satShadows: g.satShadows,
    satMids: g.satMids,
    satHighs: g.satHighs,
    hueMask,
    splitOn,
    splitShadow: ab(st.shadowHue, st.shadowAmount),
    splitHigh: ab(st.highHue, st.highAmount),
    splitBalance: st.balance,
    table,
  }
}

/** Tabla no periódica con extrapolación lineal en los extremos. */
function lookupLinear(t: Float32Array, row: number, ch: number, x: number): number {
  const N = CURVE_N
  const base = row * N
  const p = x * (N - 1)
  if (p <= 0) {
    const v0 = t[base * 4 + ch]
    return v0 + p * (t[(base + 1) * 4 + ch] - v0)
  }
  if (p >= N - 1) {
    const v1 = t[(base + N - 1) * 4 + ch]
    return v1 + (p - (N - 1)) * (v1 - t[(base + N - 2) * 4 + ch])
  }
  const i = Math.floor(p)
  const f = p - i
  const a = t[(base + i) * 4 + ch]
  return a + (t[(base + i + 1) * 4 + ch] - a) * f
}

/** Tabla no periódica, sin extrapolación (x se limita a 0..1). */
function lookupClamped(t: Float32Array, row: number, ch: number, x: number): number {
  return lookupLinear(t, row, ch, x < 0 ? 0 : x > 1 ? 1 : x)
}

/** Tabla periódica de período 1. */
function lookupPeriodic(t: Float32Array, row: number, ch: number, x: number): number {
  const N = CURVE_N
  const p = (x - Math.floor(x)) * N
  const i = Math.min(Math.floor(p), N - 1)
  const f = p - i
  const j = (i + 1) % N
  const a = t[(row * N + i) * 4 + ch]
  return a + (t[(row * N + j) * 4 + ch] - a) * f
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Pesos de sombras / medios / altas según la luminancia Oklab. */
export function tonalWeights(L: number, balance = 0): [number, number, number] {
  const x = L - balance * 0.2
  const ws = 1 - smoothstep(0.15, 0.55, x)
  const wh = smoothstep(0.45, 0.85, x)
  return [ws, Math.max(0, 1 - ws - wh), wh]
}

/** Aplica la etapa creativa a `c` (Rec.709 gamma 2.4). Modifica y devuelve `c`. */
export function evalGrade(gp: PreparedGrade, c: [number, number, number]): [number, number, number] {
  if (gp.lggOn)
    for (let i = 0; i < 3; i++) {
      const y = gp.gain[i] * (c[i] + gp.lift[i] * (1 - c[i]))
      c[i] = gp.gammaExp[i] === 1 ? y : sgnpow(y, gp.gammaExp[i])
    }
  if (gp.offsetOn) for (let i = 0; i < 3; i++) c[i] += gp.offset[i]
  if (gp.contrastOn) for (let i = 0; i < 3; i++) c[i] = (c[i] - gp.pivot) * gp.contrast + gp.pivot
  if (gp.curvesOn) {
    const t = gp.table
    for (let i = 0; i < 3; i++) {
      let v = c[i]
      if (gp.curveMask[0]) v = lookupLinear(t, 0, 0, v)
      if (gp.curveMask[i + 1]) v = lookupLinear(t, 0, i + 1, v)
      c[i] = v
    }
  }
  if (gp.okOn) {
    const t = gp.table
    let [L, a, b] = linearToOklab(decode24(c[0]), decode24(c[1]), decode24(c[2]))
    const C = Math.hypot(a, b)
    // el tono solo se usa para leer las curvas; el color se modifica escalando y rotando (a, b)
    // sin reconstruir desde polares, para no depender de la precisión trigonométrica
    const hue = Math.atan2(b, a) / (2 * Math.PI)
    let sat = gp.saturation
    if (gp.tonalOn) {
      const [ws, wm, wh] = tonalWeights(L)
      sat *= ws * gp.satShadows + wm * gp.satMids + wh * gp.satHighs
    }
    if (gp.hueMask[3]) sat *= 1 + lookupClamped(t, 1, 3, L)
    if (gp.hueMask[1]) sat *= 1 + lookupPeriodic(t, 1, 1, hue)
    if (gp.hueMask[2]) L += lookupPeriodic(t, 1, 2, hue) * HUE_LUM_MAX * Math.min(1, C / 0.08)
    const k = sat > 0 ? sat : 0
    a *= k
    b *= k
    if (gp.hueMask[0]) {
      const d = lookupPeriodic(t, 1, 0, hue) * HUE_ROTATE_MAX * 2 * Math.PI
      const [sn, cs] = sinCosSmall(d)
      const a2 = a * cs - b * sn
      b = a * sn + b * cs
      a = a2
    }
    if (gp.splitOn) {
      const [ws, , wh] = tonalWeights(L, gp.splitBalance)
      a += ws * gp.splitShadow[0] + wh * gp.splitHigh[0]
      b += ws * gp.splitShadow[1] + wh * gp.splitHigh[1]
    }
    const lin = oklabToLinear(L, a, b)
    for (let i = 0; i < 3; i++) c[i] = encode24(lin[i])
  }
  return c
}
