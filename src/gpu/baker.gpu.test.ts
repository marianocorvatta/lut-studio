import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseCube, writeCube } from '../color/cube'
import { identityLut3D, sampleLut3D, type Interpolation, type Lut1D, type Lut3D } from '../color/lut'
import { defaultParams } from '../color/params'
import { prepareLookOnly } from '../color/variants'
import { bakeCpu, evalPipeline, prepare } from '../color/pipeline'
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

  it.each<[string, number, number, number]>([
    ['neutra', 0, 6500, 0],
    ['exposición +1.5', 1.5, 6500, 0],
    ['exposición -2 y balance de blancos', -2, 3400, 35],
    ['balance frío con tinte verde', 0.3, 11000, -60],
  ])('conversión por fórmula, etapa de entrada %s', (_name, exposure, temperature, tint) => {
    const params = defaultParams()
    params.conversion.source = 'formula'
    params.input = { exposure, temperature, tint }
    for (const clamp of [true, false]) {
      params.output.clamp = clamp
      const p = prepare(params, { conversionLut: null, creativeLut: null }, 'tetrahedral')
      for (const n of [33, 65]) {
        baker.bake(p, n)
        expect(diff(baker.read().data, bakeCpu(p, n).data).max).toBeLessThan(TOL)
      }
    }
  })

  it('etapa de entrada sobre la señal log + conversión con .cube', () => {
    const params = defaultParams()
    params.input = { exposure: 0.75, temperature: 4800, tint: -20 }
    for (const interp of ['trilinear', 'tetrahedral'] as const) {
      const p = prepare(params, { conversionLut: wavyLut(33, 21, 0.05), creativeLut: null }, interp)
      expect(p.inputOn).toBe(true)
      baker.bake(p, 33)
      expect(diff(baker.read().data, bakeCpu(p, 33).data).max).toBeLessThan(TOL)
    }
  })

  it('grade realista completo: < 1e-4 en el 100 % de los nodos', () => {
    const params = defaultParams()
    params.conversion.source = 'formula'
    params.input = { exposure: 0.4, temperature: 5600, tint: 8 }
    params.grade = {
      lift: { x: 0.05, y: -0.04, master: 0.02 },
      gamma: { x: -0.03, y: 0.05, master: 0.1 },
      gain: { x: 0.04, y: 0.02, master: 1.05 },
      offset: { x: 0.01, y: 0, master: -0.01 },
      contrast: 1.15,
      pivot: 0.435,
      saturation: 1.1,
      satShadows: 0.85,
      satMids: 1,
      satHighs: 0.9,
    }
    params.curves.master = [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.21 },
      { x: 0.75, y: 0.79 },
      { x: 1, y: 1 },
    ]
    params.curves.b = [
      { x: 0, y: 0.02 },
      { x: 0.5, y: 0.48 },
      { x: 1, y: 1 },
    ]
    params.hueCurves.hueHue = [
      { x: 0.08, y: 0.15 },
      { x: 0.4, y: -0.1 },
    ]
    params.hueCurves.hueSat = [
      { x: 0.1, y: 0.2 },
      { x: 0.6, y: -0.25 },
    ]
    params.hueCurves.hueLum = [{ x: 0.3, y: -0.2 }]
    params.hueCurves.lumSat = [
      { x: 0, y: -0.3 },
      { x: 1, y: -0.2 },
    ]
    params.splitTone = { shadowHue: 220, shadowAmount: 0.3, highHue: 60, highAmount: 0.25, balance: 0.1 }
    for (const interp of ['trilinear', 'tetrahedral'] as const) {
      const p = prepare(params, { conversionLut: null, creativeLut: wavyLut(17, 3, 0.05) }, interp)
      for (const n of [33, 65]) {
        baker.bake(p, n)
        expect(diff(baker.read().data, bakeCpu(p, n).data).max).toBeLessThan(TOL)
      }
    }
  })

  it.each([1, 2, 3, 4, 5, 6])('grade aleatorio extremo #%i: 1e-4 donde está bien condicionado, acotado por la sensibilidad donde no', (seed) => {
    const rand = rng(seed * 7919)
    const u = (lo: number, hi: number) => lo + (hi - lo) * rand()
    const wheel = (k: number, m: number) => ({ x: u(-0.6, 0.6), y: u(-0.6, 0.6), master: m + u(-k, k) })
    const pts = () => {
      const xs = [0, u(0.15, 0.35), u(0.45, 0.6), u(0.7, 0.9), 1]
      return xs.map((x) => ({ x, y: Math.min(1.1, Math.max(-0.1, x + u(-0.12, 0.12))) }))
    }
    const huePts = () => [0.05, 0.3, 0.55, 0.8].map((x) => ({ x: x + u(0, 0.1), y: u(-0.8, 0.8) }))
    const params = defaultParams()
    params.conversion.source = seed % 2 ? 'formula' : 'lut'
    params.input = { exposure: u(-1, 1), temperature: u(4000, 9000), tint: u(-30, 30) }
    params.grade = {
      lift: wheel(0.08, 0),
      gamma: wheel(0.3, 0),
      gain: wheel(0.2, 1),
      offset: wheel(0.05, 0),
      contrast: u(0.7, 1.4),
      pivot: u(0.35, 0.5),
      saturation: u(0.4, 1.6),
      satShadows: u(0.5, 1.5),
      satMids: u(0.5, 1.5),
      satHighs: u(0.5, 1.5),
    }
    params.curves = { master: pts(), r: pts(), g: pts(), b: pts() }
    params.hueCurves = { hueHue: huePts(), hueSat: huePts(), hueLum: huePts(), lumSat: pts().map((p) => ({ x: p.x, y: p.y - p.x })) }
    params.splitTone = { shadowHue: u(0, 360), shadowAmount: u(0, 1), highHue: u(0, 360), highAmount: u(0, 1), balance: u(-0.5, 0.5) }
    params.creativeLut.intensity = u(0.3, 1)
    params.output.clamp = seed % 3 !== 0
    const n = 33
    const p = prepare(params, { conversionLut: wavyLut(33, seed, 0.05), creativeLut: wavyLut(17, seed + 50, 0.08) }, 'tetrahedral')
    expect(p.grade.okOn && p.grade.curvesOn && p.grade.lggOn).toBe(true)
    baker.bake(p, n)
    const gpu = baker.read().data
    const cpu = bakeCpu(p, n).data
    // sensibilidad local de la referencia: max |d salida / d entrada| por diferencias finitas
    const m = n - 1
    const h = 1e-6
    let wellMax = 0
    let ill = 0
    for (let node = 0; node < n * n * n; node++) {
      const err = Math.max(...[0, 1, 2].map((k) => Math.abs(gpu[node * 3 + k] - cpu[node * 3 + k])))
      if (err < TOL) continue
      const c0: [number, number, number] = [Math.fround((node % n) / m), Math.fround((Math.floor(node / n) % n) / m), Math.fround(Math.floor(node / n / n) / m)]
      const base = evalPipeline(p, [...c0])
      let J = 0
      for (let ch = 0; ch < 3; ch++) {
        const c: [number, number, number] = [...c0]
        c[ch] += h
        const o = evalPipeline(p, c)
        for (let k = 0; k < 3; k++) J = Math.max(J, Math.abs(o[k] - base[k]) / h)
      }
      if (J <= 100) wellMax = Math.max(wellMax, err)
      else {
        ill++
        // float32 en la GPU: el error tiene que estar acotado por la amplificación local
        expect(err).toBeLessThan(TOL + J * 2e-7)
      }
    }
    expect(wellMax).toBeLessThan(TOL)
    expect(ill / (n * n * n)).toBeLessThan(0.001) // menos del 0.1 % de los nodos mal condicionados
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

describe('solo look', () => {
  it('el LUT de solo look horneado en GPU coincide con la referencia en CPU', () => {
    const r = new Renderer(makeCanvas(16, 16))
    const params = defaultParams()
    params.input.exposure = 1 // no entra al look
    params.grade.contrast = 1.2
    params.grade.saturation = 1.15
    params.grade.gain = { x: 0.04, y: -0.02, master: 1.05 }
    params.creativeLut = { enabled: true, intensity: 0.5 }
    const luts = { conversionLut: wavyLut(33, 3), creativeLut: wavyLut(17, 4) }
    for (const interp of ['tetrahedral', 'trilinear'] as const) {
      const p = prepareLookOnly(params, luts, interp)
      expect(p.convMode).toBe(0)
      expect(p.inputOn).toBe(false)
      r.bakeAux('look', p, 33)
      const gpu = r.readAux('look')
      const cpu = bakeCpu(p, 33)
      expect(diff(gpu.data, cpu.data).max).toBeLessThan(1e-4)
    }
    r.dispose()
  })
})
