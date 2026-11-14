/**
 * Esquema único de los parámetros editables del look. De acá salen los controles de la interfaz (rangos, pasos,
 * valores neutros, textos de ayuda), la validación de presets y el documento docs/PARAMETROS_PARA_IA.md.
 *
 * El id de cada parámetro es su ruta dentro de LookParams (por ejemplo "grade.contrast"). Lógica pura.
 */
import type { LookParams, Pt } from '../color/params'

export const SCHEMA_VERSION = 1

export type Stage = 'entrada' | 'conversion' | 'creativa' | 'salida'

export const STAGES: Record<Stage, { name: string; space: string }> = {
  entrada: { name: '1. Entrada', space: 'Señal Apple Log 2, decodificada a lineal de escena en el gamut Apple Wide Gamut' },
  conversion: { name: '2. Conversión', space: 'Apple Log 2 → Rec.709 γ2.4 (con un .cube de conversión o con la fórmula)' },
  creativa: {
    name: '3. Etapa creativa',
    space: 'Rec.709 γ2.4 (valores de código 0..1); saturación, curvas de tono, split toning, match y colores trabajan en Oklab / OkLCh',
  },
  salida: { name: '4. Salida', space: 'Rec.709 γ2.4; único recorte del pipeline (opcional)' },
}

interface Base {
  id: string
  name: string
  section: string
  stage: Stage
  /** qué hace visualmente, en español */
  description: string
  /** entra en los presets (false: depende de imágenes o es una opción técnica) */
  preset: boolean
}

export interface NumberParam extends Base {
  type: 'number'
  min: number
  max: number
  step: number
  neutral: number
  unit: string
}
export interface BooleanParam extends Base {
  type: 'boolean'
  neutral: boolean
}
export interface EnumParam extends Base {
  type: 'enum'
  options: { value: string; label: string }[]
  neutral: string
}
export interface CurveParam extends Base {
  type: 'curve'
  /** rango de x e y de los puntos */
  x: [number, number]
  y: [number, number]
  /** mínimo de puntos (las curvas RGB necesitan los dos extremos) */
  minPoints: number
  maxPoints: number
  neutral: Pt[]
}
export interface QualifierListParam extends Base {
  type: 'qualifiers'
  maxItems: number
  neutral: []
}

export type ParamDef = NumberParam | BooleanParam | EnumParam | CurveParam | QualifierListParam

const n = (
  id: string,
  name: string,
  section: string,
  stage: Stage,
  [min, max, step]: [number, number, number],
  neutral: number,
  unit: string,
  description: string,
  preset = true,
): NumberParam => ({ type: 'number', id, name, section, stage, min, max, step, neutral, unit, description, preset })

const b = (id: string, name: string, section: string, stage: Stage, neutral: boolean, description: string, preset = true): BooleanParam => ({
  type: 'boolean',
  id,
  name,
  section,
  stage,
  neutral,
  description,
  preset,
})

const WHEEL_TEXT = {
  lift: 'las sombras (afecta poco a las altas)',
  gamma: 'los medios tonos',
  gain: 'las altas luces (escala toda la señal)',
  offset: 'toda la imagen por igual (suma un valor constante)',
} as const

function wheel(id: 'lift' | 'gamma' | 'gain' | 'offset', label: string, master: [number, number, number], neutral: number, masterText: string): NumberParam[] {
  const section = 'Primarias'
  return [
    n(`grade.${id}.x`, `${label}: color X (Cb)`, section, 'creativa', [-1, 1, 0.01], 0, '', `Empuja el color de ${WHEEL_TEXT[id]} sobre el eje Cb: + hacia azul, − hacia amarillo. Junto con Y forma un punto del disco (radio ≤ 1).`),
    n(`grade.${id}.y`, `${label}: color Y (Cr)`, section, 'creativa', [-1, 1, 0.01], 0, '', `Empuja el color de ${WHEEL_TEXT[id]} sobre el eje Cr: + hacia rojo, − hacia cian/verde. Junto con X forma un punto del disco (radio ≤ 1).`),
    n(`grade.${id}.master`, `${label}: maestro`, section, 'creativa', master, neutral, '', masterText),
  ]
}

const curve = (id: string, name: string, section: string, kind: 'rgb' | 'hue' | 'lum', description: string): CurveParam => ({
  type: 'curve',
  id,
  name,
  section,
  stage: 'creativa',
  description,
  preset: true,
  x: [0, 1],
  y: kind === 'rgb' ? [0, 1] : [-1, 1],
  minPoints: kind === 'rgb' ? 2 : 0,
  maxPoints: 16,
  neutral:
    kind === 'rgb'
      ? [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]
      : [],
})

export const PARAMS: ParamDef[] = [
  // --- Entrada
  n('input.exposure', 'Exposición', 'Entrada', 'entrada', [-4, 4, 0.01], 0, 'stops', 'Aclara (+) u oscurece (−) la toma como si se hubiera expuesto distinto: multiplica la luz lineal de escena por 2^stops, antes de la conversión. No entra en el LUT de solo look.'),
  n('input.temperature', 'Temperatura', 'Entrada', 'entrada', [2500, 12000, 10], 6500, 'K', 'Balance de blancos sobre la señal log (Bradford en Apple Wide Gamut). Más de 6500 K calienta la imagen (más naranja); menos, la enfría (más azul). No entra en el LUT de solo look.'),
  n('input.tint', 'Tinte', 'Entrada', 'entrada', [-100, 100, 1], 0, '', 'Compensa el eje verde–magenta del balance de blancos: + agrega magenta, − agrega verde. No entra en el LUT de solo look.'),
  // --- Conversión
  b('conversion.enabled', 'Convertir', 'Conversión', 'conversion', true, 'Activa la conversión Apple Log 2 → Rec.709. Apagada, la imagen pasa sin convertir (útil si el material ya está en Rec.709).'),
  {
    type: 'enum',
    id: 'conversion.source',
    name: 'Fuente de la conversión',
    section: 'Conversión',
    stage: 'conversion',
    options: [
      { value: 'lut', label: '.cube de conversión (por ejemplo, el oficial de Apple)' },
      { value: 'formula', label: 'Fórmula (curva de Apple + tone mapping propio)' },
    ],
    neutral: 'lut',
    description: 'Cómo se pasa de log a Rec.709. El .cube oficial de Apple es la referencia; la fórmula es una aproximación propia con más contraste en los colores saturados.',
    preset: true,
  },
  // --- Primarias
  ...wheel('lift', 'Lift', [-0.5, 0.5, 0.001], 0, 'Sube (+) o baja (−) el nivel de negro: aclara u oscurece las sombras manteniendo el blanco.'),
  ...wheel('gamma', 'Gamma', [-1, 1, 0.001], 0, 'Aclara (+) u oscurece (−) los medios tonos sin mover negro ni blanco.'),
  ...wheel('gain', 'Gain', [0, 2, 0.001], 1, 'Multiplica la señal: más de 1 aclara las altas luces (y todo en proporción), menos de 1 las baja.'),
  ...wheel('offset', 'Offset', [-0.5, 0.5, 0.001], 0, 'Suma un valor a toda la imagen: levanta o hunde todo el rango por igual, negros incluidos.'),
  n('grade.contrast', 'Contraste', 'Contraste y saturación', 'creativa', [0, 2, 0.001], 1, '×', 'Separa (más de 1) o junta (menos de 1) los tonos alrededor del pivote: más contraste oscurece las sombras y aclara las altas.'),
  n('grade.pivot', 'Pivote', 'Contraste y saturación', 'creativa', [0, 1, 0.001], 0.435, '', 'Valor de código que el contraste deja fijo. Más alto: el contraste oscurece más la imagen; más bajo: la aclara. Sin efecto con contraste 1.'),
  n('grade.saturation', 'Saturación', 'Contraste y saturación', 'creativa', [0, 2, 0.001], 1, '×', 'Intensidad de todos los colores (en Oklab, sin cambiar la luminosidad). 0 = blanco y negro, 1 = sin cambio.'),
  n('grade.satShadows', 'Saturación en sombras', 'Contraste y saturación', 'creativa', [0, 2, 0.001], 1, '×', 'Multiplica la saturación solo en las sombras (transición suave hacia los medios). Bajarla da sombras más limpias, típico de looks de cine.'),
  n('grade.satMids', 'Saturación en medios', 'Contraste y saturación', 'creativa', [0, 2, 0.001], 1, '×', 'Multiplica la saturación solo en los medios tonos (donde suelen estar la piel y la mayoría de los objetos).'),
  n('grade.satHighs', 'Saturación en altas', 'Contraste y saturación', 'creativa', [0, 2, 0.001], 1, '×', 'Multiplica la saturación solo en las altas luces. Bajarla evita cielos y luces chillones.'),
  // --- Curvas
  curve('curves.master', 'Curva Y (master)', 'Curvas', 'rgb', 'Curva de tono aplicada a los tres canales: x = valor de entrada, y = salida (0..1). Una S suave da contraste; levantar el extremo izquierdo da negros lavados (look "fade"). Spline monótona: nunca invierte.'),
  curve('curves.r', 'Curva R', 'Curvas', 'rgb', 'Curva del canal rojo: subirla agrega rojo (o quita cian) en el rango de tonos donde se suba.'),
  curve('curves.g', 'Curva G', 'Curvas', 'rgb', 'Curva del canal verde: subirla agrega verde (o quita magenta) en ese rango de tonos.'),
  curve('curves.b', 'Curva B', 'Curvas', 'rgb', 'Curva del canal azul: subirla agrega azul (o quita amarillo) en ese rango de tonos. Bajarla en las sombras y subirla en las altas da un cruce de color clásico.'),
  curve('hueCurves.hueHue', 'Tono vs tono', 'Curvas de tono (OkLCh)', 'hue', 'Gira el tono de los colores según su tono: x = tono OkLCh (0..1 = 0..360°), y = giro (±1 = ±60°). Sirve para llevar los verdes hacia el teal o los naranjas hacia el amarillo.'),
  curve('hueCurves.hueSat', 'Tono vs saturación', 'Curvas de tono (OkLCh)', 'hue', 'Cambia la saturación según el tono: x = tono OkLCh (0..1), y = cambio (factor 1 + y; −1 = sin color, +1 = el doble).'),
  curve('hueCurves.hueLum', 'Tono vs luminancia', 'Curvas de tono (OkLCh)', 'hue', 'Aclara u oscurece los colores según su tono: x = tono OkLCh (0..1), y = cambio de luminosidad (±1 = ±0.3 de L). Los neutros no se tocan.'),
  curve('hueCurves.lumSat', 'Luminancia vs saturación', 'Curvas de tono (OkLCh)', 'lum', 'Cambia la saturación según la luminosidad: x = luminancia Oklab (0..1), y = cambio (factor 1 + y). Bajarla en los extremos limpia negros y blancos.'),
  // --- Split toning
  n('splitTone.shadowHue', 'Tono de las sombras', 'Split toning', 'creativa', [0, 360, 1], 250, '°', 'Color que se agrega a las sombras (ángulo OkLCh: ~30° rojo, ~70° naranja, ~110° amarillo, ~145° verde, ~200° cian, ~250° azul, ~330° magenta).'),
  n('splitTone.shadowAmount', 'Cantidad en sombras', 'Split toning', 'creativa', [0, 1, 0.01], 0, '', 'Cuánto color agrega a las sombras. 0 = nada.'),
  n('splitTone.highHue', 'Tono de las altas', 'Split toning', 'creativa', [0, 360, 1], 70, '°', 'Color que se agrega a las altas luces (mismo ángulo OkLCh que las sombras).'),
  n('splitTone.highAmount', 'Cantidad en altas', 'Split toning', 'creativa', [0, 1, 0.01], 0, '', 'Cuánto color agrega a las altas luces. 0 = nada.'),
  n('splitTone.balance', 'Balance', 'Split toning', 'creativa', [-1, 1, 0.01], 0, '', 'Mueve el límite entre sombras y altas: + amplía la zona de sombras, − la de altas.'),
  // --- Colores
  {
    type: 'qualifiers',
    id: 'qualifiers',
    name: 'Correcciones por color',
    section: 'Colores',
    stage: 'creativa',
    maxItems: 6,
    neutral: [],
    description: 'Hasta 6 correcciones sobre un rango de colores elegido en OkLCh (ver la tabla de campos). Se aplican en orden, después de primarias, curvas y Oklab.',
    preset: true,
  },
  // --- LUT creativo
  b('creativeLut.enabled', 'LUT creativo activo', 'LUT creativo', 'creativa', true, 'Aplica el LUT creativo cargado (si hay uno). El LUT no viaja en el preset.'),
  n('creativeLut.intensity', 'Intensidad del LUT creativo', 'LUT creativo', 'creativa', [0, 1, 0.01], 1, '', 'Mezcla entre la imagen sin el LUT creativo (0) y con el LUT completo (1).'),
  // --- Match
  b('match.enabled', 'Match activo', 'Match con referencia', 'creativa', true, 'Aplica el match calculado con una imagen de referencia. Depende de imágenes: no entra en los presets.', false),
  n('match.intensity', 'Intensidad del match', 'Match con referencia', 'creativa', [0, 1, 0.01], 1, '', 'Mezcla entre la imagen sin match (0) y con el match completo (1).', false),
  b('match.protectSkin', 'Proteger piel', 'Match con referencia', 'creativa', false, 'Reduce el efecto del match cerca del tono de piel (eje I de YIQ).', false),
  // --- Salida
  b('output.clamp', 'Clamp final', 'Salida', 'salida', true, 'Recorta la salida a 0..1. Es el único recorte del pipeline; apagado, el LUT guarda valores fuera de rango.'),
]

/** Campos de cada corrección por color (los presets los validan con estos rangos). */
export const QUALIFIER_FIELDS: NumberParam[] = [
  n('hue.center', 'Tono: centro', 'Colores', 'creativa', [0, 360, 1], 30, '°', 'Tono OkLCh del color a corregir (~30° rojo, ~55° piel/naranja, ~110° amarillo, ~145° verde, ~200° cian, ~250° azul).'),
  n('hue.width', 'Tono: ancho', 'Colores', 'creativa', [0, 180, 1], 20, '°', 'Medio ancho de la zona plena alrededor del centro. 180 = todos los tonos.'),
  n('hue.soft', 'Tono: suavidad', 'Colores', 'creativa', [0, 90, 1], 30, '°', 'Ancho del borde suave. Bordes suaves = sin quiebres en el LUT (mínimo efectivo 2°).'),
  n('chroma.center', 'Croma: centro', 'Colores', 'creativa', [0, 0.4, 0.001], 0.1, '', 'Croma Oklab del color (0 = gris, ~0.1 piel, ~0.25 rojo puro).'),
  n('chroma.width', 'Croma: ancho', 'Colores', 'creativa', [0, 0.4, 0.001], 0.08, '', 'Medio ancho de la zona plena en croma.'),
  n('chroma.soft', 'Croma: suavidad', 'Colores', 'creativa', [0, 0.2, 0.001], 0.08, '', 'Borde suave en croma (mínimo efectivo 0.005).'),
  n('luma.center', 'Luminancia: centro', 'Colores', 'creativa', [0, 1, 0.005], 0.6, '', 'Luminancia Oklab del color (0 = negro, 1 = blanco).'),
  n('luma.width', 'Luminancia: ancho', 'Colores', 'creativa', [0, 1, 0.005], 0.25, '', 'Medio ancho de la zona plena en luminancia.'),
  n('luma.soft', 'Luminancia: suavidad', 'Colores', 'creativa', [0, 0.5, 0.005], 0.25, '', 'Borde suave en luminancia (mínimo efectivo 0.01).'),
  n('adjust.hue', 'Ajuste: tono', 'Colores', 'creativa', [-180, 180, 1], 0, '°', 'Gira el tono de lo seleccionado (lleva el color hacia otro).'),
  n('adjust.sat', 'Ajuste: saturación', 'Colores', 'creativa', [0, 2, 0.01], 1, '×', 'Multiplica la saturación de lo seleccionado.'),
  n('adjust.lum', 'Ajuste: luminancia', 'Colores', 'creativa', [-0.3, 0.3, 0.005], 0, '', 'Aclara (+) u oscurece (−) lo seleccionado (luminancia Oklab).'),
  n('intensity', 'Intensidad', 'Colores', 'creativa', [0, 1, 0.01], 1, '', 'Cuánto se aplica la corrección (0 = nada).'),
]

/** Partes de LookParams que no son parámetros editables (derivadas de imágenes). */
export const NON_EDITABLE = ['match.model'] as const

export const PARAM_BY_ID = new Map(PARAMS.map((p) => [p.id, p]))

export function numberParam(id: string): NumberParam {
  const p = PARAM_BY_ID.get(id)
  if (!p || p.type !== 'number') throw new Error(`"${id}" no es un parámetro numérico del esquema.`)
  return p
}

export function getParam(params: LookParams, id: string): unknown {
  return id.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], params)
}

export function setParam(params: LookParams, id: string, value: unknown): void {
  const keys = id.split('.')
  const last = keys.pop()!
  const obj = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, params as unknown as Record<string, unknown>)
  obj[last] = value
}
