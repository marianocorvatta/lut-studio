/**
 * Presets: solo parámetros (sin imágenes ni LUTs), con la versión del esquema, nombre, descripción y los valores
 * que difieren del neutro. Lo que no aparece queda en neutro. La validación (Zod) sale del esquema.
 */
import { z } from 'zod'
import { defaultParams, type LookParams } from '../color/params'
import { MAX_QUALIFIERS, newQualifier, normalizeQualifier, type Qualifier } from '../color/qualifiers'
import { getParam, PARAMS, QUALIFIER_FIELDS, SCHEMA_VERSION, setParam, type ParamDef } from './schema'

export const PRESET_FORMAT = 'lut-studio-preset'

export type PresetValues = Record<string, unknown>

export interface Preset {
  format: typeof PRESET_FORMAT
  schemaVersion: typeof SCHEMA_VERSION
  name: string
  description: string
  params: PresetValues
}

const range = (min: number, max: number, unit = '') => z.number().min(min).max(max).describe(`${min} a ${max}${unit ? ` ${unit}` : ''}`)

function curveSchema(p: Extract<ParamDef, { type: 'curve' }>) {
  const pt = z.strictObject({ x: range(p.x[0], p.x[1]), y: range(p.y[0], p.y[1]) })
  return z
    .array(pt)
    .min(p.minPoints)
    .max(p.maxPoints)
    .refine((pts) => pts.every((q, i) => i === 0 || q.x > pts[i - 1].x), { message: 'los puntos tienen que estar ordenados por x, sin repetir x' })
}

/** Una corrección por color en un preset: todos los campos opcionales (lo que falta toma el valor inicial). */
export const qualifierPresetSchema = (() => {
  const field = (id: string) => {
    const f = QUALIFIER_FIELDS.find((q) => q.id === id)!
    return range(f.min, f.max, f.unit).optional()
  }
  const win = (k: string) => z.strictObject({ center: field(`${k}.center`), width: field(`${k}.width`), soft: field(`${k}.soft`) }).optional()
  return z.strictObject({
    name: z.string().max(40).optional(),
    enabled: z.boolean().optional(),
    hue: win('hue'),
    chroma: win('chroma'),
    luma: win('luma'),
    adjust: z.strictObject({ hue: field('adjust.hue'), sat: field('adjust.sat'), lum: field('adjust.lum') }).optional(),
    intensity: field('intensity'),
  })
})()

function paramSchema(p: ParamDef): z.ZodType {
  switch (p.type) {
    case 'number':
      return range(p.min, p.max, p.unit)
    case 'boolean':
      return z.boolean()
    case 'enum':
      return z.enum(p.options.map((o) => o.value) as [string, ...string[]])
    case 'curve':
      return curveSchema(p)
    case 'qualifiers':
      return z.array(qualifierPresetSchema).max(p.maxItems)
  }
}

const presetParams = PARAMS.filter((p) => p.preset)

export const presetParamsSchema = z
  .strictObject(Object.fromEntries(presetParams.map((p) => [p.id, paramSchema(p).optional().describe(p.description)])))
  .superRefine((v, ctx) => {
    // las ruedas son un punto del disco
    for (const w of ['lift', 'gamma', 'gain', 'offset']) {
      const x = (v as PresetValues)[`grade.${w}.x`]
      const y = (v as PresetValues)[`grade.${w}.y`]
      if (typeof x === 'number' && typeof y === 'number' && Math.hypot(x, y) > 1 + 1e-9)
        ctx.addIssue({ code: 'custom', path: [`grade.${w}.x`], message: `grade.${w}.x y grade.${w}.y forman un punto fuera del disco (radio ${Math.hypot(x, y).toFixed(3)} > 1)` })
    }
  })

export const presetSchema = z.strictObject({
  format: z.literal(PRESET_FORMAT),
  schemaVersion: z.literal(SCHEMA_VERSION),
  name: z.string().min(1).max(80),
  description: z.string().max(2000),
  params: presetParamsSchema,
})

const pathText = (path: PropertyKey[]) =>
  path
    .map((k, i) => (typeof k === 'number' ? `[${k}]` : i === 0 ? String(k) : i === 1 && path[0] === 'params' ? `["${String(k)}"]` : `.${String(k)}`))
    .join('')

/** Mensajes claros, uno por problema, que nombran el parámetro y el rango permitido. */
export function formatIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => {
    const where = pathText(i.path)
    switch (i.code) {
      case 'unrecognized_keys':
        return `${where || 'raíz'}: ${i.keys.map((k) => `"${k}"`).join(', ')} no ${i.keys.length > 1 ? 'son parámetros válidos' : 'es un parámetro válido'}${
          where === 'params' ? ' (ver docs/PARAMETROS_PARA_IA.md)' : ''
        }`
      case 'too_big':
        return `${where}: ${i.origin === 'array' ? `admite como máximo ${i.maximum} elementos` : `el valor supera el máximo (${i.maximum})`}`
      case 'too_small':
        return `${where}: ${i.origin === 'array' ? `necesita al menos ${i.minimum} elementos` : i.origin === 'string' ? 'no puede estar vacío' : `el valor está por debajo del mínimo (${i.minimum})`}`
      case 'invalid_type':
        return `${where}: se esperaba ${i.expected === 'number' ? 'un número' : i.expected === 'boolean' ? 'true o false' : i.expected === 'string' ? 'un texto' : i.expected === 'array' ? 'una lista' : i.expected === 'object' ? 'un objeto' : i.expected}`
      case 'invalid_value':
        return `${where}: valor no permitido (se acepta ${i.values.map((v) => JSON.stringify(v)).join(' o ')})`
      default:
        return `${where}: ${i.message}`
    }
  })
}

export type PresetResult = { ok: true; preset: Preset } | { ok: false; errors: string[] }

export function parsePreset(text: string): PresetResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['El archivo no es un JSON válido.'] }
  }
  if (raw && typeof raw === 'object' && 'format' in raw && (raw as { format: unknown }).format === 'lut-studio-project')
    return { ok: false, errors: ['Es un proyecto, no un preset: abrilo con "Abrir proyecto…".'] }
  const r = presetSchema.safeParse(raw)
  return r.success ? { ok: true, preset: r.data as Preset } : { ok: false, errors: formatIssues(r.error) }
}

/** Parámetros del look a partir de un preset: todo en neutro y encima los valores del preset. */
export function applyPreset(preset: Preset, base: LookParams = defaultParams()): LookParams {
  const params = structuredClone(base)
  for (const p of PARAMS) if (p.preset) setParam(params, p.id, structuredClone(p.neutral))
  for (const [id, value] of Object.entries(preset.params)) {
    if (id === 'qualifiers') {
      params.qualifiers = (value as Partial<Qualifier>[]).slice(0, MAX_QUALIFIERS).map((q) => {
        const d = newQualifier(q.name ?? '')
        return normalizeQualifier({
          ...d,
          ...q,
          hue: { ...d.hue, ...q.hue },
          chroma: { ...d.chroma, ...q.chroma },
          luma: { ...d.luma, ...q.luma },
          adjust: { ...d.adjust, ...q.adjust },
        })
      })
    } else setParam(params, id, structuredClone(value))
  }
  return params
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Preset con los valores del look que difieren del neutro (sin el match, que depende de imágenes). */
export function presetFromParams(params: LookParams, name: string, description = ''): Preset {
  const values: PresetValues = {}
  for (const p of PARAMS) {
    if (!p.preset) continue
    const v = getParam(params, p.id)
    if (p.type === 'qualifiers') {
      const list = (v as Qualifier[]).map(({ id: _id, ...q }) => {
        void _id
        return q
      })
      if (list.length) values[p.id] = list
    } else if (!same(v, p.neutral)) values[p.id] = structuredClone(v)
  }
  return { format: PRESET_FORMAT, schemaVersion: SCHEMA_VERSION, name, description, params: values }
}

/** JSON Schema del preset (para documentación y para validar fuera de la app). */
export function presetJsonSchema(): unknown {
  return z.toJSONSchema(presetSchema, { target: 'draft-2020-12' })
}
