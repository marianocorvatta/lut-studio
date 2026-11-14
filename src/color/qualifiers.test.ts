import { describe, expect, it } from 'vitest'
import { analyzeLut } from './analyze'
import { decode24, encode24 } from './grade'
import type { Lut3D, RGB } from './lut'
import { oklabToLinear } from './oklab'
import { defaultParams, type LookParams } from './params'
import { bakeCpu, evalPipeline, prepare } from './pipeline'
import { newQualifier, normalizeQualifier, sinCosWide, toLch, type Qualifier } from './qualifiers'

const res = { conversionLut: null, creativeLut: null }
const lookParams = (qs: Qualifier[]): LookParams => {
  const p = defaultParams()
  p.conversion.enabled = false
  p.output.clamp = false
  p.qualifiers = qs
  return p
}
const bake = (qs: Qualifier[], n = 33) => bakeCpu(prepare(lookParams(qs), res, 'tetrahedral'), n) as Lut3D
const fromLch = (L: number, C: number, hDeg: number): RGB => {
  const h = (hDeg * Math.PI) / 180
  const lin = oklabToLinear(L, C * Math.cos(h), C * Math.sin(h))
  return [encode24(lin[0]), encode24(lin[1]), encode24(lin[2])]
}
const q = (patch: Partial<Qualifier>): Qualifier => ({ ...newQualifier('t'), ...patch })

describe('corrección por color (qualifiers)', () => {
  it('sin correcciones, intensidad 0, ajustes neutros o selección vacía: identidad exacta', () => {
    const base = bake([])
    const shift = { hue: 40, sat: 1.3, lum: 0.05 }
    expect(bake([q({ adjust: shift, intensity: 0 })]).data).toEqual(base.data)
    expect(bake([q({ adjust: { hue: 0, sat: 1, lum: 0 } })]).data).toEqual(base.data)
    expect(bake([q({ adjust: shift, enabled: false })]).data).toEqual(base.data)
    // selección vacía: croma 0.39 ± lo mínimo (ningún color Rec.709 llega)
    expect(bake([q({ adjust: shift, chroma: { center: 0.39, width: 0, soft: 0 } })]).data).toEqual(base.data)
  })

  it('desplazar el tono de un color conocido produce el tono esperado (y no cambia L ni C)', () => {
    for (const [h0, shift] of [
      [40, 60],
      [200, -150],
      [300, 170],
    ]) {
      const c = fromLch(0.6, 0.09, h0)
      const p = prepare(lookParams([q({ hue: { center: h0, width: 15, soft: 10 }, chroma: { center: 0.09, width: 0.05, soft: 0.03 }, luma: { center: 0.6, width: 0.2, soft: 0.1 }, adjust: { hue: shift, sat: 1, lum: 0 } })]), res, 'tetrahedral')
      const out = toLch(evalPipeline(p, [...c] as RGB))
      const want = (h0 + shift + 360) % 360
      expect(Math.abs(((out.h - want + 540) % 360) - 180)).toBeLessThan(0.01)
      expect(out.L).toBeCloseTo(0.6, 6)
      expect(out.C).toBeCloseTo(0.09, 6)
    }
  })

  it('la selección es continua: colores muy cercanos tienen pesos muy cercanos', () => {
    const p = prepare(lookParams([q({ adjust: { hue: 30, sat: 1.3, lum: 0.04 } })]), res, 'tetrahedral', { qualifier: { index: 0, mode: 'mask' } })
    let seed = 3
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
    for (let i = 0; i < 5000; i++) {
      const x: RGB = [rnd(), rnd(), rnd()]
      const y: RGB = [x[0] + 1e-4, x[1] - 1e-4, x[2] + 1e-4]
      expect(Math.abs(evalPipeline(p, x)[0] - evalPipeline(p, y)[0])).toBeLessThan(0.02)
    }
  })

  it('sin saltos entre nodos vecinos del LUT; en 65³ una corrección moderada no deja quiebres', () => {
    const qs = [
      q({ hue: { center: 40, width: 20, soft: 30 }, adjust: { hue: 20, sat: 1.2, lum: 0 } }),
      q({ hue: { center: 240, width: 25, soft: 30 }, chroma: { center: 0.12, width: 0.1, soft: 0.08 }, adjust: { hue: -15, sat: 0.8, lum: 0 } }),
    ]
    for (const n of [33, 65]) {
      const lut = bake(qs, n)
      const st = [1, n, n * n]
      let worst = 0
      for (let i = 0; i < n ** 3; i++)
        for (const s of st) {
          const j = i + s
          if (j >= n ** 3 || (s === 1 && i % n === n - 1) || (s === n && Math.floor(i / n) % n === n - 1)) continue
          // en lineal: cerca de 0 la codificación γ2.4 es casi vertical (un color que sale del gamut cruza el cero) y
          // en código eso parece un salto aunque la función sea continua
          for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(decode24(lut.data[j * 3 + c]) - decode24(lut.data[i * 3 + c])))
        }
      expect(worst).toBeLessThan(4 / (n - 1)) // la identidad da a lo sumo 2.4/(n-1) en lineal; un salto daría mucho más
      // una sola corrección moderada con las suavidades por defecto: en 65³ el análisis no encuentra quiebres
      if (n === 65) expect(analyzeLut(bake([qs[0]], 65)).breakCells).toBe(0)
    }
  })

  it('el gotero lee el valor antes de la corrección que se edita', () => {
    const a = q({ hue: { center: 40, width: 30, soft: 20 }, adjust: { hue: 25, sat: 1.2, lum: 0 } })
    const b = q({ hue: { center: 60, width: 30, soft: 20 }, adjust: { hue: -10, sat: 0.8, lum: 0.02 } })
    const params = lookParams([a, b])
    params.grade.contrast = 1.1
    const c = fromLch(0.6, 0.1, 45)
    const atB = evalPipeline(prepare(params, res, 'tetrahedral', { qualifier: { index: 1, mode: 'stop' } }), [...c] as RGB)
    const onlyA = { ...params, qualifiers: [a] }
    const afterA = evalPipeline(prepare(onlyA, res, 'tetrahedral'), [...c] as RGB)
    for (let k = 0; k < 3; k++) expect(atB[k]).toBeCloseTo(afterA[k], 12)
    const atA = evalPipeline(prepare(params, res, 'tetrahedral', { qualifier: { index: 0, mode: 'stop' } }), [...c] as RGB)
    const noQual = evalPipeline(prepare({ ...params, qualifiers: [] }, res, 'tetrahedral'), [...c] as RGB)
    for (let k = 0; k < 3; k++) expect(atA[k]).toBeCloseTo(noQual[k], 12)
  })

  it('la máscara es el peso de la selección (1 en el centro, 0 lejos), en gris', () => {
    const sel = q({ hue: { center: 40, width: 10, soft: 10 }, chroma: { center: 0.1, width: 0.04, soft: 0.03 }, luma: { center: 0.6, width: 0.1, soft: 0.1 }, intensity: 0.75, adjust: { hue: 0, sat: 1, lum: 0 } })
    const p = prepare(lookParams([sel]), res, 'tetrahedral', { qualifier: { index: 0, mode: 'mask' } })
    const center = evalPipeline(p, fromLch(0.6, 0.1, 40))
    expect(center).toEqual([0.75, 0.75, 0.75])
    expect(evalPipeline(p, fromLch(0.6, 0.1, 160))).toEqual([0, 0, 0])
  })

  it('normaliza correcciones incompletas o fuera de rango; seno y coseno anchos son exactos', () => {
    const n = normalizeQualifier({ name: 'piel', hue: { center: 400, width: -3 }, adjust: { sat: 9 } })
    expect(n.hue.center).toBe(360)
    expect(n.hue.width).toBe(0)
    expect(n.adjust.sat).toBe(2)
    expect(n.name).toBe('piel')
    for (const t of [-Math.PI, -2, -0.3, 0, 1, 2.9, Math.PI]) {
      const [s, c] = sinCosWide(t)
      expect(s).toBeCloseTo(Math.sin(t), 8) // la serie a un tercio del ángulo: < 2e-9 en ±π
      expect(c).toBeCloseTo(Math.cos(t), 8)
    }
  })
})
