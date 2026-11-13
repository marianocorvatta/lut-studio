import { describe, expect, it } from 'vitest'
import { applyLutToImage, CODE10, compareImages, diffImage } from '../color/compare'
import { identityLut3D } from '../color/lut'
import { chartImage, chartTiff, CHART_H, CHART_W, generateChart } from './chart'
import { decodeImage } from './image'

const toAB = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer

describe('chart de prueba', () => {
  it('se genera a 1920x1080, en 16 bits, y el decodificador lo lee exacto', async () => {
    const tif = chartTiff()
    const img = await decodeImage(toAB(tif), 'chart.tif')
    expect([img.width, img.height, img.bitDepth]).toEqual([CHART_W, CHART_H, 16])
    expect(img.hasICC).toBe(false)
    expect(img.data).toEqual(chartImage().data)
  })

  it('contiene negro, blanco, los nodos de un LUT 33 y colores fuera del eje neutro', () => {
    const u = generateChart()
    const values = new Set<number>()
    let chroma = 0
    for (let i = 0; i < u.length; i += 3) {
      if (u[i] === u[i + 1] && u[i] === u[i + 2]) values.add(u[i])
      else chroma++
    }
    expect(values.has(0)).toBe(true)
    expect(values.has(65535)).toBe(true)
    for (let k = 0; k <= 32; k++) expect(values.has(Math.round((k / 32) * 65535))).toBe(true)
    expect(chroma).toBeGreaterThan(CHART_W * CHART_H * 0.4)
  })
})

describe('comparación píxel a píxel', () => {
  it('imágenes idénticas: error cero', () => {
    const img = chartImage(64, 36)
    const out = applyLutToImage(identityLut3D(33), img, 'tetrahedral')
    const s = compareImages(out, img)
    expect(s.max).toBeLessThan(2e-6)
    expect(s.overCode10).toBe(0)
  })

  it('detecta y ubica una diferencia', () => {
    const a = chartImage(64, 36)
    const b = { ...a, data: a.data.slice() }
    const o = (10 * 64 + 20) * 4
    b.data[o + 1] += 3 * CODE10
    const s = compareImages(a, b)
    expect(s.max).toBeCloseTo(3 * CODE10, 6)
    expect(s.maxPerChannel[0]).toBe(0)
    expect(s.worst).toMatchObject({ x: 20, y: 10 })
    expect(s.overCode10).toBeCloseTo(1 / (64 * 36), 9)
    expect(diffImage(s, 100).data[o]).toBeCloseTo(Math.min(1, 300 * CODE10), 5)
    expect(() => compareImages(a, chartImage(32, 18))).toThrow(/tamaños no coinciden/)
  })
})
