/**
 * Apple Log 2: curva de transferencia, matrices de gamut y balance de blancos (Bradford).
 * Matemática pura. Las constantes viven en appleLog2.constants.ts.
 */
import { APPLE_LOG_CURVE as K, APPLE_WIDE_GAMUT, FORMULA_TONE_MAP as TM, REC709 } from './appleLog2.constants'
import { identity3, invert3, mul3, mulVec3, type Mat3 } from './mat3'

export const APPLE_LOG_PT = K.c * (K.Rt - K.R0) ** 2

/** Señal Apple Log (0..1) -> lineal de escena. */
export function appleLogDecode(p: number): number {
  if (p >= APPLE_LOG_PT) return 2 ** ((p - K.delta) / K.gamma) - K.beta
  if (p >= 0) return Math.sqrt(p / K.c) + K.R0
  return K.R0
}

/** Lineal de escena -> señal Apple Log. */
export function appleLogEncode(r: number): number {
  if (r >= K.Rt) return K.gamma * Math.log2(r + K.beta) + K.delta
  if (r >= K.R0) return K.c * (r - K.R0) ** 2
  return 0
}

type XY = readonly [number, number]

const xyToXYZ = ([x, y]: XY): [number, number, number] => [x / y, 1, (1 - x - y) / y]

/** Matriz RGB lineal -> XYZ a partir de primarios y blanco (método estándar, SMPTE RP 177). */
export function rgbToXyzMatrix(red: XY, green: XY, blue: XY, white: XY): Mat3 {
  const r = xyToXYZ(red)
  const g = xyToXYZ(green)
  const b = xyToXYZ(blue)
  const P: Mat3 = [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]]
  const s = mulVec3(invert3(P), xyToXYZ(white))
  return [P[0] * s[0], P[1] * s[1], P[2] * s[2], P[3] * s[0], P[4] * s[1], P[5] * s[2], P[6] * s[0], P[7] * s[1], P[8] * s[2]]
}

export const AWG_TO_XYZ = rgbToXyzMatrix(APPLE_WIDE_GAMUT.red, APPLE_WIDE_GAMUT.green, APPLE_WIDE_GAMUT.blue, APPLE_WIDE_GAMUT.white)
export const XYZ_TO_AWG = invert3(AWG_TO_XYZ)
export const REC709_TO_XYZ = rgbToXyzMatrix(REC709.red, REC709.green, REC709.blue, REC709.white)
export const XYZ_TO_REC709 = invert3(REC709_TO_XYZ)
/** Apple Wide Gamut lineal -> Rec.709 lineal (mismo blanco D65: sin adaptación cromática). */
export const AWG_TO_REC709 = mul3(XYZ_TO_REC709, AWG_TO_XYZ)

const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296]
const BRADFORD_INV = invert3(BRADFORD)

/** Adaptación cromática Bradford en XYZ: del blanco `src` al blanco `dst` (ambos en xy). */
export function bradford(src: XY, dst: XY): Mat3 {
  const s = mulVec3(BRADFORD, xyToXYZ(src))
  const d = mulVec3(BRADFORD, xyToXYZ(dst))
  const scale: Mat3 = [d[0] / s[0], 0, 0, 0, d[1] / s[1], 0, 0, 0, d[2] / s[2]]
  return mul3(BRADFORD_INV, mul3(scale, BRADFORD))
}

/** Lugar de Planck en CIE 1960 (u, v). Aproximación de Krystek (1985), válida de 1000 K a 15000 K. */
function planckUV(T: number): [number, number] {
  const u = (0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T) / (1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T)
  const v = (0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T) / (1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T)
  return [u, v]
}

export const WB_NEUTRAL_TEMPERATURE = 6500
/** Duv por unidad de tinte (tinte ±100 => Duv ±0.03) */
const TINT_TO_DUV = 0.0003

/** Blanco (xy) para una temperatura en kelvin y un tinte (+ = iluminante más verde, sobre el lugar de Planck). */
export function whiteXY(temperature: number, tint: number): [number, number] {
  const [u0, v0] = planckUV(temperature)
  const [u1, v1] = planckUV(temperature + 1)
  // normal al lugar de Planck, apuntando hacia v creciente (verde)
  let nx = -(v1 - v0)
  let ny = u1 - u0
  const len = Math.hypot(nx, ny)
  nx /= len
  ny /= len
  if (ny < 0) {
    nx = -nx
    ny = -ny
  }
  const u = u0 + nx * tint * TINT_TO_DUV
  const v = v0 + ny * tint * TINT_TO_DUV
  const d = 2 * u - 8 * v + 4
  return [(3 * u) / d, (2 * v) / d]
}

/**
 * Matriz de la etapa de entrada, en Apple Wide Gamut lineal: exposición (stops) y balance de blancos.
 *
 * Balance de blancos: se declara que el iluminante de la escena era `temperature`/`tint` y se adapta
 * (Bradford) al blanco neutro de referencia (6500 K, tinte 0). Subir la temperatura calienta la imagen;
 * subir el tinte la lleva hacia magenta. En los valores por defecto la matriz es exactamente la identidad.
 */
export function inputMatrix(exposureStops: number, temperature: number, tint: number): Mat3 {
  const gain = 2 ** exposureStops
  let m: Mat3 = identity3()
  if (temperature !== WB_NEUTRAL_TEMPERATURE || tint !== 0) {
    const cat = bradford(whiteXY(temperature, tint), whiteXY(WB_NEUTRAL_TEMPERATURE, 0))
    m = mul3(XYZ_TO_AWG, mul3(cat, AWG_TO_XYZ))
  }
  return m.map((v) => v * gain) as Mat3
}

/** Constantes derivadas del tone mapping de la conversión por fórmula. */
export const TONE = (() => {
  const kn = TM.midpoint ** TM.contrast
  const wn = TM.whiteLinear ** TM.contrast
  return { n: TM.contrast, kn, s: (wn + kn) / wn, invGamma: 1 / TM.displayGamma }
})()

/** Rec.709 lineal de escena -> señal Rec.709 gamma 2.4 (tone mapping por canal). */
export function formulaToneMap(linear: number): number {
  const l = linear > 0 ? linear : 0
  const ln = l ** TONE.n
  return ((TONE.s * ln) / (ln + TONE.kn)) ** TONE.invGamma
}
