import { describe, expect, it } from 'vitest'
import type { RGB } from '../color/lut'
import { defaultParams } from '../color/params'
import { evalPipeline, prepare } from '../color/pipeline'
import { toLch } from '../color/qualifiers'
import docFile from '../../docs/PARAMETROS_PARA_IA.md?raw'
import { generateParamsDoc } from './doc'
import { EXAMPLE_PRESETS } from './examples'
import { applyPreset, parsePreset, presetFromParams, presetJsonSchema, PRESET_FORMAT, type Preset } from './preset'
import { getParam, NON_EDITABLE, PARAMS, QUALIFIER_FIELDS, SCHEMA_VERSION } from './schema'
import { newQualifier } from '../color/qualifiers'

/** Hojas de LookParams: valores escalares y listas (curvas, correcciones) con su ruta. */
function leaves(o: unknown, prefix = ''): string[] {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return [prefix]
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
}

const wrap = (params: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: PRESET_FORMAT, schemaVersion: SCHEMA_VERSION, name: 'x', description: '', params, ...extra })

describe('esquema de parámetros', () => {
  it('cubre todos los parámetros del look, sin sobrantes', () => {
    const ids = PARAMS.map((p) => p.id).sort()
    const all = leaves(defaultParams())
      .filter((id) => !(NON_EDITABLE as readonly string[]).includes(id))
      .sort()
    expect(ids).toEqual(all)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('el valor neutro de cada parámetro es el valor por defecto de la app', () => {
    const d = defaultParams()
    for (const p of PARAMS) expect(getParam(d, p.id), p.id).toEqual(p.neutral)
  })

  it('los campos de las correcciones por color arrancan en los valores iniciales de la app', () => {
    const q = newQualifier()
    for (const f of QUALIFIER_FIELDS) expect(f.id.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], q), f.id).toBe(f.neutral)
  })

  it('cada parámetro tiene nombre, sección y descripción; los numéricos, rango y paso coherentes', () => {
    for (const p of PARAMS) {
      expect(p.name.length && p.section.length && p.description.length > 20, p.id).toBeTruthy()
      if (p.type === 'number') {
        expect(p.min, p.id).toBeLessThan(p.max)
        expect(p.neutral, p.id).toBeGreaterThanOrEqual(p.min)
        expect(p.neutral, p.id).toBeLessThanOrEqual(p.max)
        expect(p.step, p.id).toBeGreaterThan(0)
      }
    }
  })
})

describe('presets', () => {
  it('los presets de ejemplo son válidos, cambian el look y van y vuelven sin cambios', () => {
    expect(EXAMPLE_PRESETS.map((p) => p.name)).toEqual(['Neutro con más contraste', 'Teal and orange suave', 'Cálido cinematográfico respetando piel', 'Atardecer cálido en la piel', 'Atardecer por separación de color', 'Película cálida tipo Portra', 'Natural documental', 'Luminoso y pastel', 'Nostalgia Super 8', 'Invierno o día nublado', 'Blanco y negro con contraste'])
    for (const p of EXAMPLE_PRESETS) {
      const r = parsePreset(JSON.stringify(p))
      if (!r.ok) throw new Error(`${p.name}: ${r.errors.join('; ')}`)
      const params = applyPreset(r.preset)
      expect(JSON.stringify(params), p.name).not.toEqual(JSON.stringify(defaultParams()))
      const back = presetFromParams(params, p.name, p.description)
      const again = parsePreset(JSON.stringify(back))
      expect(again.ok).toBe(true)
      const strip = (x: typeof params) => ({ ...x, qualifiers: x.qualifiers.map(({ id: _id, ...q }) => (void _id, q)) })
      expect(strip(applyPreset(back))).toEqual(strip(params))
    }
  })

  it('lo que no aparece en el preset queda en neutro (también el look anterior)', () => {
    const prev = defaultParams()
    prev.grade.saturation = 1.7
    prev.qualifiers = applyPreset(EXAMPLE_PRESETS[1]).qualifiers
    const r = parsePreset(wrap({ 'grade.contrast': 1.2 }))
    expect(r.ok).toBe(true)
    const p = applyPreset((r as { ok: true; preset: never }).preset, prev)
    expect(p.grade.contrast).toBe(1.2)
    expect(p.grade.saturation).toBe(1)
    expect(p.qualifiers).toEqual([])
  })

  it('aplicar un preset no toca la entrada ni la conversión (dependen del material)', () => {
    const base = defaultParams()
    base.conversion = { enabled: true, source: 'formula' }
    base.input.exposure = 0.7
    const r = parsePreset(wrap({ 'grade.contrast': 1.2, 'conversion.source': 'lut', 'input.exposure': -1 }))
    expect(r.ok).toBe(true)
    const p = applyPreset((r as { ok: true; preset: Preset }).preset, base)
    expect(p.conversion).toEqual({ enabled: true, source: 'formula' })
    expect(p.input.exposure).toBe(0.7)
    expect(p.grade.contrast).toBe(1.2)
    expect(presetFromParams(base, 'a').params).toEqual({})
  })

  it('un preset del look actual solo lleva lo que difiere del neutro', () => {
    const p = defaultParams()
    p.grade.contrast = 1.3
    p.splitTone.highAmount = 0.2
    p.input.exposure = 0.5
    expect(presetFromParams(p, 'a').params).toEqual({ 'grade.contrast': 1.3, 'splitTone.highAmount': 0.2 })
  })

  it('errores claros: parámetro inexistente, fuera de rango, ruedas, curvas, formato', () => {
    const errs = (text: string) => {
      const r = parsePreset(text)
      expect(r.ok).toBe(false)
      return (r as { ok: false; errors: string[] }).errors.join('\n')
    }
    expect(errs(wrap({ 'grade.contraste': 1.2 }))).toMatch(/"grade\.contraste" no es un parámetro válido/)
    expect(errs(wrap({ 'grade.contrast': 3 }))).toMatch(/params\["grade\.contrast"\]: el valor supera el máximo \(2\)/)
    expect(errs(wrap({ 'splitTone.shadowHue': -5 }))).toMatch(/params\["splitTone\.shadowHue"\]: el valor está por debajo del mínimo \(0\)/)
    expect(errs(wrap({ 'grade.saturation': '1.2' }))).toMatch(/grade\.saturation"\]: se esperaba un número/)
    expect(errs(wrap({ 'grade.gain.x': 0.8, 'grade.gain.y': 0.8 }))).toMatch(/fuera del disco/)
    expect(errs(wrap({ 'curves.r': [{ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.3 }] }))).toMatch(/ordenados por x/)
    expect(errs(wrap({ qualifiers: [{ adjust: { hue: 400 } }] }))).toMatch(/qualifiers"\]\[0\]\.adjust\.hue: el valor supera el máximo \(180\)/)
    expect(errs(wrap({ qualifiers: [{ hue: { centro: 3 } }] }))).toMatch(/"centro" no es un parámetro válido/)
    expect(errs(wrap({ 'match.intensity': 0.5 }))).toMatch(/"match\.intensity" no es un parámetro válido/)
    expect(errs(wrap({}, { schemaVersion: 2 }))).toMatch(/schemaVersion/)
    expect(errs('{ no es json')).toMatch(/JSON válido/)
    expect(errs(JSON.stringify({ format: 'lut-studio-project' }))).toMatch(/proyecto/)
  })

  it('el JSON Schema describe todos los parámetros de los presets', () => {
    const js = presetJsonSchema() as { properties: { params: { properties: Record<string, unknown>; additionalProperties: boolean } } }
    const keys = Object.keys(js.properties.params.properties).sort()
    expect(keys).toEqual(PARAMS.filter((p) => p.preset).map((p) => p.id).sort())
    expect(js.properties.params.additionalProperties).toBe(false)
  })

  it('"Cálido cinematográfico respetando piel": la piel se desvía mucho menos que sin las correcciones de piel', () => {
    const res = { conversionLut: null, creativeLut: null }
    const look = { ...applyPreset(EXAMPLE_PRESETS[2]), conversion: { enabled: false, source: 'lut' as const } }
    const skins: RGB[] = [
      [0.85, 0.68, 0.58],
      [0.78, 0.6, 0.48],
      [0.72, 0.52, 0.4],
      [0.6, 0.42, 0.32],
      [0.45, 0.3, 0.22],
    ]
    const worst = (p: typeof look) => {
      let dh = 0
      let dc = 0
      for (const s of skins) {
        const a = toLch(s)
        const o = toLch(evalPipeline(prepare(p, res, 'tetrahedral'), [...s] as RGB))
        dh = Math.max(dh, Math.abs(o.h - a.h))
        dc = Math.max(dc, Math.abs(o.C / a.C - 1))
      }
      return { dh, dc }
    }
    const withSkin = worst(look)
    const without = worst({ ...look, qualifiers: [] })
    // medido: tono 13.3° -> 5.3°, croma 45 % -> 10 %
    expect(withSkin.dh).toBeLessThan(without.dh * 0.5)
    expect(withSkin.dc).toBeLessThan(0.15)
    expect(without.dc).toBeGreaterThan(0.3)
  })
})

describe('documento para IA', () => {
  it('docs/PARAMETROS_PARA_IA.md está al día con el esquema (si falla: npm run docs:params)', () => {
    expect(docFile).toBe(generateParamsDoc())
  })

  it('incluye todos los parámetros, los tres presets de ejemplo y el JSON Schema', () => {
    const doc = generateParamsDoc()
    for (const p of PARAMS) expect(doc).toContain(`\`${p.id}\``)
    for (const p of EXAMPLE_PRESETS) expect(doc).toContain(`### ${p.name}`)
    expect(doc).toContain('"$schema"')
    expect(doc).toMatch(/No puede agregar grano, viñeta/)
  })
})
