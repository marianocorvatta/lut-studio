import { describe, expect, it } from 'vitest'
import { identityLut3D } from '../color/lut'
import { defaultParams } from '../color/params'
import { commitHistory, newHistory, redoHistory, undoHistory } from '../ui/history'
import { lutHash, parseProject, ProjectError, serializeProject } from './project'

function sampleLut() {
  const lut = identityLut3D(5)
  for (let i = 0; i < lut.data.length; i++) lut.data[i] = Math.fround(Math.sin(i) * 0.7 + 0.2)
  return lut
}

describe('proyecto JSON', () => {
  it('ida y vuelta de todos los parámetros y referencias', () => {
    const params = defaultParams()
    params.grade.gain = { x: 0.1, y: -0.2, master: 1.1 }
    params.curves.r = [
      { x: 0, y: 0 },
      { x: 0.4, y: 0.5 },
      { x: 1, y: 1 },
    ]
    params.hueCurves.hueSat = [{ x: 0.3, y: 0.4 }]
    const lut = sampleLut()
    const text = serializeProject({
      params,
      lutSize: 65,
      interpolation: 'trilinear',
      conversionLut: { name: 'conv.cube', lut },
      creativeLut: null,
      embedLuts: false,
    })
    const back = parseProject(text)
    expect(back.params).toEqual(params)
    expect(back.lutSize).toBe(65)
    expect(back.interpolation).toBe('trilinear')
    expect(back.conversionLut?.ref).toEqual({ name: 'conv.cube', kind: '3D', size: 5, hash: lutHash(lut), cube: undefined })
    expect(back.conversionLut?.lut).toBeNull()
    expect(back.creativeLut).toBeNull()
  })

  it('los LUTs incrustados vuelven bit a bit', () => {
    const lut = sampleLut()
    const text = serializeProject({
      params: defaultParams(),
      lutSize: 33,
      interpolation: 'tetrahedral',
      conversionLut: null,
      creativeLut: { name: 'look.cube', lut },
      embedLuts: true,
    })
    const back = parseProject(text)
    expect(back.creativeLut?.lut?.data).toEqual(lut.data)
    expect(back.warnings).toEqual([])
  })

  it('completa proyectos viejos con valores por defecto y rechaza archivos ajenos', () => {
    const old = JSON.stringify({ format: 'lut-studio-project', version: 1, params: { input: { exposure: 1 } } })
    const back = parseProject(old)
    expect(back.params.input.exposure).toBe(1)
    expect(back.params.grade).toEqual(defaultParams().grade)
    expect(() => parseProject('{')).toThrow(ProjectError)
    expect(() => parseProject('{"format":"otro"}')).toThrow(/no es un proyecto/)
    expect(() => parseProject('{"format":"lut-studio-project","version":99}')).toThrow(/no soportada/)
  })

  it('la huella distingue LUTs distintos', () => {
    const a = sampleLut()
    const b = sampleLut()
    expect(lutHash(a)).toBe(lutHash(b))
    b.data[7] += 1e-6
    expect(lutHash(a)).not.toBe(lutHash(b))
  })
})

describe('historial de deshacer', () => {
  it('commit, deshacer y rehacer', () => {
    const p0 = defaultParams()
    let h = newHistory(p0)
    const p1 = { ...p0, grade: { ...p0.grade, contrast: 1.2 } }
    h = commitHistory(h, p1)
    const p2 = { ...p1, grade: { ...p1.grade, contrast: 1.4 } }
    // p2 sin registrar: deshacer lo registra y vuelve a p1
    let u = undoHistory(h, p2)!
    expect(u.params.grade.contrast).toBe(1.2)
    u = undoHistory(u.h, u.params)!
    expect(u.params.grade.contrast).toBe(1)
    expect(undoHistory(u.h, u.params)).toBeNull()
    let r = redoHistory(u.h, u.params)!
    expect(r.params.grade.contrast).toBe(1.2)
    r = redoHistory(r.h, r.params)!
    expect(r.params.grade.contrast).toBe(1.4)
    expect(redoHistory(r.h, r.params)).toBeNull()
    // un cambio nuevo descarta el futuro
    const back = undoHistory(r.h, r.params)!
    const p3 = { ...back.params, grade: { ...back.params.grade, contrast: 0.5 } }
    expect(redoHistory(commitHistory(back.h, p3), p3)).toBeNull()
  })

  it('commit sin cambios no agrega pasos', () => {
    const p0 = defaultParams()
    const h = newHistory(p0)
    expect(commitHistory(h, structuredClone(p0))).toBe(h)
  })
})
