/**
 * ============================================================================
 *  CONSTANTES DE APPLE LOG 2  —  REVISAR CONTRA EL WHITE PAPER OFICIAL
 * ============================================================================
 *
 * Fuente primaria: Apple, "Apple Log Profile White Paper"
 *   https://developer.apple.com/download/all/?q=Apple%20log%20profile   (requiere cuenta de desarrollador)
 *
 * Este archivo es el ÚNICO lugar donde viven estas constantes. Cada bloque dice de dónde
 * salió y si pudo verificarse contra el documento de Apple. No se inventó ningún valor:
 * lo que no pudo verificarse está marcado con `verified: false` y la app lo avisa.
 *
 * Apple Log 2 usa la MISMA curva de transferencia que Apple Log (1) y cambia el gamut:
 * Apple Log usa primarios Rec.2020; Apple Log 2 usa "Apple Wide Gamut". No mezclarlos.
 */

/**
 * Curva de transferencia (compartida por Apple Log y Apple Log 2).
 *
 * VERIFICADO: coinciden con la implementación de colour-science
 * (colour.models.rgb.transfer_functions.apple_log_profile), que cita el white paper de Apple (2023).
 *
 *   Decodificación (señal P -> lineal de escena R):
 *     P >= Pt        R = 2^((P - delta) / gamma) - beta
 *     0 <= P < Pt    R = sqrt(P / c) + R0
 *     P < 0          R = R0
 *   con  Pt = c * (Rt - R0)^2
 */
export const APPLE_LOG_CURVE = {
  verified: true,
  source: 'Apple Log Profile White Paper (vía colour-science)',
  R0: -0.05641088,
  Rt: 0.01,
  c: 47.28711236,
  beta: 0.00964052,
  gamma: 0.08550479,
  delta: 0.69336945,
} as const

/**
 * Primarios de "Apple Wide Gamut" (gamut de Apple Log 2), coordenadas CIE xy, blanco D65.
 *
 * NO VERIFICADO contra el PDF de Apple (no se pudo acceder al documento).
 * Los valores vienen de fuentes secundarias coincidentes entre sí:
 *   - gamut.io, "Apple Log vs. Apple Log 2: What's Actually Different?"
 *   - captura de DaVinci Resolve 20.2 (espacio de color "Apple Wide Gamut")
 *   - issue #1428 de colour-science/colour ("Add support for Apple Log 2")
 *
 * >>> Si tenés el white paper, confirmá estos seis números y el punto blanco, y poné `verified: true`. <<<
 */
export const APPLE_WIDE_GAMUT = {
  verified: false,
  source: 'Fuentes secundarias (gamut.io, DaVinci Resolve 20.2, colour-science #1428)',
  red: [0.725, 0.301],
  green: [0.221, 0.814],
  blue: [0.068, -0.076],
  white: [0.3127, 0.329],
} as const

/** Rec.709 / sRGB: ITU-R BT.709-6. */
export const REC709 = {
  verified: true,
  source: 'ITU-R BT.709-6',
  red: [0.64, 0.33],
  green: [0.3, 0.6],
  blue: [0.15, 0.06],
  white: [0.3127, 0.329],
} as const

/**
 * Tone mapping de la conversión por fórmula (lineal de escena -> lineal de display, por canal).
 *
 * El white paper define la curva y el gamut, NO un tone mapping a Rec.709. Esta curva es una
 * elección propia de LUT Studio (Naka-Rushton), ajustada para parecerse al eje neutro del LUT
 * oficial "AppleLog2ToRec709". No pretende reproducir ese LUT: para eso está la opción
 * "cargar .cube de conversión", que es la que se usa por defecto.
 *
 *   T(L) = s * L^n / (L^n + k^n),   s tal que T(whiteLinear) = 1
 *   salida = T(max(L, 0)) ^ (1 / 2.4)        (codificación Rec.709 gamma 2.4)
 */
export const FORMULA_TONE_MAP = {
  contrast: 1.52,
  midpoint: 0.365,
  /** lineal de escena que se mapea a blanco de display: es el valor que decodifica la señal 1.0 */
  whiteLinear: 12,
  displayGamma: 2.4,
} as const
