import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseCube, writeCube } from '../color/cube'
import { identityLut3D, sampleLut3D, type Interpolation, type Lut1D, type Lut3D } from '../color/lut'
import { defaultParams } from '../color/params'
import { bakeCpu, prepare } from '../color/pipeline'
import type { FloatImage } from '../io/image'
import { Baker } from './baker'
import { createGL, type GL } from './gl'
import { Renderer } from './renderer'
import { diff, makeCanvas, rng, wavyLut } from './testUtils'

const TOL = 1e-4

describe('horneado en GPU vs referencia en CPU', () => {
  let g: GL
  let baker: Baker
  beforeAll(() => {
    g = createGL(makeCanvas(4, 4))
    baker = new Baker(g)
  })
  afterAll(() => baker.dispose())

  it('pipeline neutro = LUT identidad exacto', () => {
    for (const n of [33, 65]) {
      const p = prepare(defaultParams(), { conversionLut: null, creativeLut: null }, 'tetrahedral')
      baker.bake(p, n)
      const d = diff(baker.read().data, identityLut3D(n).data)
      expect(d.max).toBe(0)
    }
  })

  it.each<[Interpolation, number]>([
    ['trilinear', 33],
    ['tetrahedral', 33],
    ['trilinear', 65],
    ['tetrahedral', 65],
  ])('conversión + LUT creativo con intensidad (%s, N=%i)', (interp, n) => {
    const conv = wavyLut(33, 1)
    const creative: Lut3D = { ...wavyLut(17, 2, 0.1), domainMin: [-0.25, -0.25, -0.25], domainMax: [1.5, 1.5, 1.5] }
    for (const clamp of [true, false]) {
      const params = defaultParams()
      params.creativeLut.intensity = 0.65
      params.output.clamp = clamp
      const p = prepare(params, { conversionLut: conv, creativeLut: creative }, interp)
      baker.bake(p, n)
      const d = diff(baker.read().data, bakeCpu(p, n).data)
      expect(d.max).toBeLessThan(TOL)
      if (!clamp) expect(Math.max(...baker.read().data.subarray(0, 3000))).toBeGreaterThan(1) // sin clamp intermedio ni final
    }
  })

  it('LUT 1D como conversión', () => {
    const lut1: Lut1D = { kind: '1D', size: 64, data: new Float32Array(64 * 3), domainMin: [0, 0, 0], domainMax: [1, 1, 1] }
    for (let i = 0; i < 64; i++) {
      const x = i / 63
      lut1.data.set([x ** 2.2, Math.sqrt(x), 1 - x], i * 3)
    }
    const p = prepare(defaultParams(), { conversionLut: lut1, creativeLut: null }, 'tetrahedral')
    baker.bake(p, 33)
    expect(diff(baker.read().data, bakeCpu(p, 33).data).max).toBeLessThan(TOL)
  })

  it('lo exportado es lo horneado: el .cube leído de la GPU vuelve a dar el mismo LUT', () => {
    const p = prepare(defaultParams(), { conversionLut: wavyLut(33, 5), creativeLut: null }, 'tetrahedral')
    baker.bake(p, 33)
    const baked = baker.read()
    const back = parseCube(writeCube(baked, { title: 'export' }))
    expect(back.size).toBe(33)
    expect(diff(back.data, baked.data).max).toBeLessThanOrEqual(5.1e-7) // solo el redondeo a 6 decimales
  })
})

describe('el preview es el LUT', () => {
  it.each<Interpolation>(['trilinear', 'tetrahedral'])('imagen procesada en GPU = LUT horneado aplicado en CPU (%s)', (interp) => {
    const W = 96
    const H = 64
    const canvas = makeCanvas(W, H)
    const r = new Renderer(canvas)
    const rand = rng(11)
    const data = new Float32Array(W * H * 4)
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = rand() * 1.2 - 0.1
      data[i * 4 + 1] = rand() * 1.2 - 0.1
      data[i * 4 + 2] = rand() * 1.2 - 0.1
      data[i * 4 + 3] = 1
    }
    const img: FloatImage = { width: W, height: H, data, bitDepth: 32, format: 'TIFF', hasICC: false, warnings: [], name: 't' }
    r.setImage(img)
    r.resize()
    expect([canvas.width, canvas.height]).toEqual([W, H])
    r.view = { cx: W / 2, cy: H / 2, scale: 1 }
    r.interpolation = interp

    const p = prepare(defaultParams(), { conversionLut: wavyLut(33, 9), creativeLut: null }, interp)
    const gpuLut = r.bake(p, 33)
    r.setLayers([{ lut: gpuLut, opacity: 1 }])
    r.render()

    const baked = r.readBaked()
    const out = r.readProcessed()!
    const expected = new Float32Array(W * H * 3)
    const got = new Float32Array(W * H * 3)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const src = (y * W + x) * 4
        const px = sampleLut3D(baked, [data[src], data[src + 1], data[src + 2]], interp)
        expected.set(px, (y * W + x) * 3)
        const o = ((H - 1 - y) * W + x) * 4 // la lectura de GL tiene la fila 0 abajo
        got.set([out.data[o], out.data[o + 1], out.data[o + 2]], (y * W + x) * 3)
      }
    expect(diff(got, expected).max).toBeLessThan(TOL)

    // un LUT identidad deja la imagen idéntica
    r.setLayers([{ lut: identityLut3D(33), opacity: 1 }])
    r.render()
    const idOut = r.readProcessed()!
    const gotId = new Float32Array(W * H * 3)
    const clamped = new Float32Array(W * H * 3)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = ((H - 1 - y) * W + x) * 4
        const src = (y * W + x) * 4
        for (let c = 0; c < 3; c++) {
          gotId[(y * W + x) * 3 + c] = idOut.data[o + c]
          clamped[(y * W + x) * 3 + c] = Math.min(1, Math.max(0, data[src + c]))
        }
      }
    expect(diff(gotId, clamped).max).toBeLessThan(2e-6)
    r.dispose()
    canvas.remove()
  })
})
