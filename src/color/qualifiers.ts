/**
 * Corrección por color (qualifiers): hasta MAX_QUALIFIERS correcciones, cada una con una selección suave en OkLCh
 * (tono, croma, luminancia: centro, ancho y suavidad) y ajustes sobre lo seleccionado (desplazamiento de tono,
 * saturación, luminancia, intensidad). Van después de la etapa de primarias, curvas y Oklab, y antes del LUT creativo.
 *
 * La selección es continua: cada eje es 1 - smoothstep(ancho, ancho + suavidad, distancia), con suavidad mínima,
 * y el peso por tono se desvanece con la croma (en el neutro el tono no está definido). Con peso 0 el color no se
 * toca: selección vacía o intensidad 0 = identidad exacta.
 *
 * Referencia en CPU; gpu/qualifierGlsl.ts replica cada operación y el test CPU vs GPU cubre las dos.
 */
import { decode24, encode24, sinCosSmall } from './grade'
import { linearToOklab, oklabToLinear } from './oklab'

export const MAX_QUALIFIERS = 6
/** suavidades mínimas: sin bordes duros, que generarían quiebres en el LUT */
export const MIN_SOFT = { hue: 2, chroma: 0.005, luma: 0.01 }
/** la ventana de tono pleno arranca a desvanecerse por debajo de esta croma (Oklab) */
export const HUE_FADE_C: [number, number] = [0.005, 0.05]

export interface Window1 {
  center: number
  /** medio ancho de la zona plena */
  width: number
  /** ancho del borde suave */
  soft: number
}

export interface Qualifier {
  id: string
  name: string
  enabled: boolean
  /** grados: centro 0..360, ancho 0..180 (180 = todos los tonos), suavidad 0..90 */
  hue: Window1
  /** croma Oklab: centro 0..0.4, ancho 0..0.4, suavidad 0..0.2 */
  chroma: Window1
  /** luminancia Oklab: centro 0..1, ancho 0..1, suavidad 0..0.5 */
  luma: Window1
  adjust: {
    /** grados, -180..180 */
    hue: number
    /** factor de saturación, 0..2 (1 = sin cambio) */
    sat: number
    /** desplazamiento de luminancia Oklab, -0.3..0.3 */
    lum: number
  }
  /** 0..1 */
  intensity: number
}

let seq = 1
export function newQualifier(name = ''): Qualifier {
  return {
    id: `q${Date.now().toString(36)}${seq++}`,
    name,
    enabled: true,
    // suavidades amplias por defecto: un borde empinado no se representa bien en un LUT de 33 nodos
    hue: { center: 30, width: 20, soft: 30 },
    chroma: { center: 0.1, width: 0.08, soft: 0.08 },
    luma: { center: 0.6, width: 0.25, soft: 0.25 },
    adjust: { hue: 0, sat: 1, lum: 0 },
    intensity: 1,
  }
}

const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
const win = (r: unknown, d: Window1, lim: [number, number, number]): Window1 => {
  const o = (r && typeof r === 'object' ? r : {}) as Partial<Window1>
  return { center: num(o.center, d.center, 0, lim[0]), width: num(o.width, d.width, 0, lim[1]), soft: num(o.soft, d.soft, 0, lim[2]) }
}

/** Completa y acota una corrección (por ejemplo, de un proyecto o un preset). */
export function normalizeQualifier(raw: unknown): Qualifier {
  const d = newQualifier()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Qualifier>
  const a = (r.adjust && typeof r.adjust === 'object' ? r.adjust : {}) as Partial<Qualifier['adjust']>
  return {
    id: typeof r.id === 'string' && r.id ? r.id : d.id,
    name: typeof r.name === 'string' ? r.name : '',
    enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    hue: win(r.hue, d.hue, [360, 180, 90]),
    chroma: win(r.chroma, d.chroma, [0.4, 0.4, 0.2]),
    luma: win(r.luma, d.luma, [1, 1, 0.5]),
    adjust: { hue: num(a.hue, 0, -180, 180), sat: num(a.sat, 1, 0, 2), lum: num(a.lum, 0, -0.3, 0.3) },
    intensity: num(r.intensity, 1, 0, 1),
  }
}

export const isNeutralAdjust = (q: Qualifier) => q.adjust.hue === 0 && q.adjust.sat === 1 && q.adjust.lum === 0

// ---------------------------------------------------------------------------------------------------------------

/** Una corrección lista para evaluar (unidades internas: tono en vueltas, ángulos en radianes). */
export interface PreparedQualifier {
  /** centro, medio ancho y suavidad del tono, en vueltas; full = todos los tonos */
  hue: [number, number, number]
  hueFull: boolean
  chroma: [number, number, number]
  luma: [number, number, number]
  /** radianes */
  rot: number
  sat: number
  lum: number
  intensity: number
}

export function prepareQualifier(q: Qualifier): PreparedQualifier {
  return {
    hue: [q.hue.center / 360, q.hue.width / 360, Math.max(MIN_SOFT.hue, q.hue.soft) / 360],
    hueFull: q.hue.width >= 180,
    chroma: [q.chroma.center, q.chroma.width, Math.max(MIN_SOFT.chroma, q.chroma.soft)],
    luma: [q.luma.center, q.luma.width, Math.max(MIN_SOFT.luma, q.luma.soft)],
    rot: (q.adjust.hue * Math.PI) / 180,
    sat: q.adjust.sat,
    lum: q.adjust.lum,
    intensity: q.intensity,
  }
}

/** Correcciones que pueden cambiar algo (activas, con intensidad y con algún ajuste). Vacío = etapa apagada. */
export function prepareQualifiers(list: readonly Qualifier[] | undefined): PreparedQualifier[] {
  return (list ?? [])
    .slice(0, MAX_QUALIFIERS)
    .filter((q) => q.enabled && q.intensity > 0 && !isNeutralAdjust(q))
    .map(prepareQualifier)
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const band = (d: number, w: number, s: number) => 1 - smoothstep(w, w + s, d)

/** Peso de selección (0..1) de un color Oklab. `hue` en vueltas. */
export function qualifierWeight(q: PreparedQualifier, L: number, C: number, hue: number): number {
  const wl = band(Math.abs(L - q.luma[0]), q.luma[1], q.luma[2])
  if (wl === 0) return 0
  const wc = band(Math.abs(C - q.chroma[0]), q.chroma[1], q.chroma[2])
  if (wc === 0) return 0
  let wh = 1
  if (!q.hueFull) {
    const d = Math.abs(hue - q.hue[0] - Math.floor(hue - q.hue[0] + 0.5))
    wh = band(d, q.hue[1], q.hue[2]) * smoothstep(HUE_FADE_C[0], HUE_FADE_C[1], C)
  }
  return wl * wc * wh
}

/** cos y sin de un ángulo de hasta ±π: serie a un tercio del ángulo y fórmula del ángulo triple (igual en la GPU). */
export function sinCosWide(t: number): [number, number] {
  const [s, c] = sinCosSmall(t / 3)
  return [s * (3 - 4 * s * s), c * (4 * c * c - 3)]
}

/** Aplica una corrección a un color Oklab. Devuelve el peso usado (0 = sin cambio). */
function applyLab(q: PreparedQualifier, lab: [number, number, number]): number {
  const [L, a, b] = lab
  const C = Math.hypot(a, b)
  const hue = Math.atan2(b, a) / (2 * Math.PI)
  const k = qualifierWeight(q, L, C, hue) * q.intensity
  if (k === 0) return 0
  const [sn, cs] = sinCosWide(q.rot * k)
  const f = Math.max(0, 1 + (q.sat - 1) * k)
  lab[0] = L + q.lum * k
  lab[1] = (a * cs - b * sn) * f
  lab[2] = (a * sn + b * cs) * f
  return k
}

/**
 * Aplica las correcciones a `c` (Rec.709 γ2.4), en orden. `stop`: aplica solo las anteriores a esa (para el
 * gotero, que lee el valor antes de la corrección que se está editando). Modifica y devuelve `c`.
 */
export function evalQualifiers(list: readonly PreparedQualifier[], c: [number, number, number], stop = list.length): [number, number, number] {
  for (let i = 0; i < Math.min(stop, list.length); i++) {
    const lab = linearToOklab(decode24(c[0]), decode24(c[1]), decode24(c[2]))
    if (applyLab(list[i], lab) === 0) continue
    const lin = oklabToLinear(lab[0], lab[1], lab[2])
    c[0] = encode24(lin[0])
    c[1] = encode24(lin[1])
    c[2] = encode24(lin[2])
  }
  return c
}

/** Peso (máscara) de una corrección para un color Rec.709 γ2.4. */
export function maskWeight(q: PreparedQualifier, c: readonly [number, number, number]): number {
  const [L, a, b] = linearToOklab(decode24(c[0]), decode24(c[1]), decode24(c[2]))
  return qualifierWeight(q, L, Math.hypot(a, b), Math.atan2(b, a) / (2 * Math.PI)) * q.intensity
}

/** OkLCh de un color Rec.709 γ2.4: L, C y tono en grados (0..360). */
export function toLch(c: readonly number[]): { L: number; C: number; h: number } {
  const [L, a, b] = linearToOklab(decode24(c[0]), decode24(c[1]), decode24(c[2]))
  const h = (Math.atan2(b, a) * 180) / Math.PI
  return { L, C: Math.hypot(a, b), h: h < 0 ? h + 360 : h }
}

/** Selección inicial centrada en un color tomado con el gotero. */
export function selectionFromSample(c: readonly number[]): Pick<Qualifier, 'hue' | 'chroma' | 'luma'> {
  const { L, C, h } = toLch(c)
  return {
    hue: { center: Math.round(h * 10) / 10, width: C < 0.02 ? 180 : 20, soft: 30 },
    chroma: { center: C, width: Math.max(0.04, C * 0.6), soft: 0.08 },
    luma: { center: L, width: 0.25, soft: 0.25 },
  }
}
