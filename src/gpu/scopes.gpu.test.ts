import { describe, expect, it } from 'vitest'
import type { FloatImage } from '../io/image'
import { Renderer } from './renderer'
import { WAVE_MAX, WAVE_MIN } from './scopes'
import { makeCanvas } from './testUtils'

function solidImage(w: number, h: number, f: (x: number, y: number) => [number, number, number]): FloatImage {
  const data = new Float32Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      data.set([...f(x, y), 1], o)
    }
  return { width: w, height: h, data, bitDepth: 32, format: 'TIFF', hasICC: false, warnings: [], name: 's' }
}

describe('scopes en GPU', () => {
  it('histograma: cuenta exacta por bin y por canal', () => {
    const r = new Renderer(makeCanvas(64, 64))
    const W = 200
    const H = 100
    // mitad izquierda R=0.25, mitad derecha R=0.75; G constante 0.5; B rampa
    r.setImage(solidImage(W, H, (x) => [x < W / 2 ? 0.25 : 0.75, 0.5, x / (W - 1)]))
    r.setLayers([])
    const hst = r.computeScope('histogram')!
    expect(hst.samples).toBe(W * H)
    const bin = (v: number) => Math.floor(v * 255 + 0.5)
    expect(hst.data[bin(0.25) * 4]).toBe((W * H) / 2)
    expect(hst.data[bin(0.75) * 4]).toBe((W * H) / 2)
    expect(hst.data[bin(0.5) * 4 + 1]).toBe(W * H)
    let totalB = 0
    for (let i = 0; i < 256; i++) totalB += hst.data[i * 4 + 2]
    expect(totalB).toBe(W * H)
    r.dispose()
  })

  it('waveform y vectorscopio ubican los valores donde corresponde', () => {
    const r = new Renderer(makeCanvas(64, 64))
    r.setImage(solidImage(128, 64, () => [0.6, 0.6, 0.6]))
    r.setLayers([])
    const wf = r.computeScope('waveform')!
    const row = Math.floor(((0.6 - WAVE_MIN) / (WAVE_MAX - WAVE_MIN)) * wf.height)
    let inRow = 0
    let total = 0
    for (let y = 0; y < wf.height; y++)
      for (let x = 0; x < wf.width; x++) {
        const v = wf.data[(y * wf.width + x) * 4]
        total += v
        if (y === row) inRow += v
      }
    expect(total).toBe(128 * 64)
    expect(inRow).toBe(total)
    const vs = r.computeScope('vectorscope')!
    // un gris cae en el centro exacto (borde entre las 4 celdas centrales)
    let center = 0
    for (const [x, y] of [[127, 127], [128, 127], [127, 128], [128, 128]]) center += vs.data[(y * vs.width + x) * 4]
    expect(center).toBe(128 * 64)
    r.dispose()
  })
})
