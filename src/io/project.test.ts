import { describe, expect, it } from 'vitest'
import { identityLut3D } from '../color/lut'
import { defaultParams } from '../color/params'
import { commitHistory, newHistory, redoHistory, undoHistory } from '../ui/history'
import type { FloatImage } from './image'
import { bytesHash, frameHash, lutHash, parseProject, ProjectError, serializeProject } from './project'

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

describe('proyecto con varios frames', () => {
  const img = (bits: 8 | 16 | 32, name: string): FloatImage => {
    const w = 37
    const h = 11
    const data = new Float32Array(w * h * 4)
    const max = 2 ** (bits === 32 ? 16 : bits) - 1
    for (let i = 0; i < w * h; i++)
      for (let c = 0; c < 4; c++) {
        const u = (i * 7919 + c * 104729) % (max + 1)
        // 16 bits: como el decodificador TIFF (u * 1/max); 8 bits: como el de JPEG (u / 255); 32: valores libres
        data[i * 4 + c] = c === 3 ? 1 : bits === 32 ? u / max + 0.123456 : bits === 16 ? u * (1 / max) : u / max
      }
    return { width: w, height: h, data, bitDepth: bits, format: bits === 8 ? 'JPEG' : 'TIFF', hasICC: false, warnings: [], name }
  }
  const base = { params: defaultParams(), lutSize: 33 as const, interpolation: 'tetrahedral' as const, conversionLut: null, creativeLut: null, embedLuts: false }

  it('por referencia: nombre, etiqueta, huella y principal', () => {
    const frames = [
      { label: 'piel', image: img(16, 'a.tif') },
      { label: 'cielo', image: img(8, 'b.jpg') },
    ]
    const back = parseProject(serializeProject({ ...base, frames, activeFrame: 1, embedFrames: false }))
    expect(back.activeFrame).toBe(1)
    expect(back.frames.map((f) => [f.ref.name, f.ref.label, f.ref.hash, f.image])).toEqual([
      ['a.tif', 'piel', frameHash(frames[0].image), null],
      ['b.jpg', 'cielo', frameHash(frames[1].image), null],
    ])
  })

  it('incluidos: los píxeles vuelven exactos (8, 16 bits y float)', () => {
    const frames = [
      { label: 'piel', image: img(16, 'a.tif') },
      { label: '', image: img(8, 'b.jpg') },
      { label: 'noche', image: img(32, 'c.tif') },
    ]
    const text = serializeProject({ ...base, frames, activeFrame: 2, embedFrames: true })
    const raw = JSON.parse(text)
    expect(raw.frames.map((f: { pixels: { encoding: string } }) => f.pixels.encoding)).toEqual(['u16', 'u8', 'f32'])
    const back = parseProject(text)
    expect(back.warnings).toEqual([])
    back.frames.forEach((f, i) => {
      expect(f.image!.data).toEqual(frames[i].image.data)
      expect(f.ref.label).toBe(frames[i].label)
    })
  })

  it('un proyecto sin frames (versión anterior) se abre igual', () => {
    const raw = JSON.parse(serializeProject(base))
    delete raw.frames
    delete raw.activeFrame
    const back = parseProject(JSON.stringify(raw))
    expect(back.frames).toEqual([])
    expect(back.activeFrame).toBe(0)
  })
})

describe('proyecto con match', () => {
  const base = { params: defaultParams(), lutSize: 33 as const, interpolation: 'tetrahedral' as const, conversionLut: null, creativeLut: null, embedLuts: false }
  const model = {
    curve: { x: [0.1, 0.5, 0.9], y: [0.12, 0.48, 0.93] },
    bands: [
      { A: [1.1, 0.02, 0.02, 0.95], t: [0.01, -0.005] },
      { A: [1, 0, 0, 1], t: [0, 0] },
      { A: [0.9, -0.01, -0.01, 1.05], t: [-0.004, 0.012] },
    ],
    info: { reference: 'ref.jpg', frames: 2, samples: 1234 },
  } as never
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256).buffer

  it('el modelo viaja en los parámetros; la referencia por huella o incluida', () => {
    const params = defaultParams()
    params.match = { enabled: true, intensity: 0.7, protectSkin: true, model }
    for (const embed of [false, true]) {
      const back = parseProject(serializeProject({ ...base, params, reference: { name: 'ref.jpg', bytes }, embedReference: embed }))
      expect(back.params.match).toEqual(params.match)
      expect(back.reference?.ref.name).toBe('ref.jpg')
      expect(back.reference?.ref.hash).toBe(bytesHash(new Uint8Array(bytes)))
      if (embed) expect(new Uint8Array(back.reference!.bytes!)).toEqual(new Uint8Array(bytes))
      else expect(back.reference?.bytes).toBeNull()
    }
  })

  it('un proyecto anterior (sin match) se abre con el match apagado y sin modelo', () => {
    const raw = JSON.parse(serializeProject(base))
    delete raw.params.match
    delete raw.reference
    const back = parseProject(JSON.stringify(raw))
    expect(back.params.match.model).toBeNull()
    expect(back.reference).toBeNull()
  })
})
