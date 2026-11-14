import { describe, expect, it } from 'vitest'
import { analyzeLut, FLAG_BREAK, FLAG_CLIP_HIGH, FLAG_INVERSION, pixelStats } from './analyze'
import type { Lut3D } from './lut'
import { defaultParams } from './params'
import { bakeCpu } from './pipeline'
import { prepareLookOnly } from './variants'

/** LUT suave: contraste en S por canal y un tinte leve, todo dentro de 0..1. */
function smoothLut(n: number): Lut3D {
  const data = new Float32Array(n * n * n * 3)
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const c = [r, g, b].map((v) => v / (n - 1))
        const o = (r + n * (g + n * b)) * 3
        for (let k = 0; k < 3; k++) {
          const s = 0.5 + 0.5 * Math.sin(Math.PI * (c[k] - 0.5)) // curva en S suave
          data[o + k] = Math.min(1, Math.max(0, 0.03 + 0.94 * s + (k === 2 ? 0.01 : 0)))
        }
      }
  return { kind: '3D', size: n, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }
}

const at = (n: number, r: number, g: number, b: number) => r + n * (g + n * b)

describe('diagnóstico del LUT', () => {
  it('LUT suave: sin alertas (33 y 65)', () => {
    for (const n of [33, 65]) {
      const d = analyzeLut(smoothLut(n))
      expect([d.breakCells, d.inversionCells, d.clipLowCells, d.clipHighCells, d.grayInversions]).toEqual([0, 0, 0, 0, 0])
    }
  })

  it('el look solo de un grade realista: eje de grises monótono, sin quiebres en la zona media', () => {
    const p = defaultParams()
    p.output.clamp = false
    p.grade.contrast = 1.1
    p.grade.saturation = 1.1
    p.grade.gain = { x: 0.03, y: 0.02, master: 1.05 }
    const d = analyzeLut(bakeCpu(prepareLookOnly(p, { conversionLut: null, creativeLut: null }, 'tetrahedral', false), 33) as Lut3D)
    expect(d.grayInversions).toBe(0)
    expect(d.inversionCells / d.cells).toBeLessThan(0.001)
    for (let b = 8; b <= 24; b++)
      for (let g = 8; g <= 24; g++) for (let r = 8; r <= 24; r++) expect(d.nodeFlags[at(33, r, g, b)] & FLAG_BREAK).toBe(0)
  })

  it('un salto inyectado se detecta como quiebre, en el lugar del salto', () => {
    const n = 33
    const lut = smoothLut(n)
    // salto de 0.03 en el canal verde entre g = 16 y g = 17, para un bloque de r y b
    for (let b = 10; b < 20; b++) for (let r = 10; r < 20; r++) for (let g = 17; g < n; g++) lut.data[at(n, r, g, b) * 3 + 1] += 0.03
    const d = analyzeLut(lut)
    expect(d.breakCells).toBeGreaterThan(0)
    expect(d.nodeFlags[at(n, 15, 16, 15)] & FLAG_BREAK).toBe(FLAG_BREAK)
    expect(d.nodeFlags[at(n, 15, 17, 15)] & FLAG_BREAK).toBe(FLAG_BREAK)
    // lejos del salto, nada
    expect(d.nodeFlags[at(n, 5, 5, 5)]).toBe(0)
    expect(d.nodeFlags[at(n, 28, 28, 28)]).toBe(0)
  })

  it('un pico aislado de 3 códigos de 8 bits ya se detecta en un LUT suave', () => {
    const n = 33
    const lut = smoothLut(n)
    lut.data[at(n, 12, 20, 7) * 3] += 3 / 255
    const d = analyzeLut(lut)
    expect(d.nodeFlags[at(n, 12, 20, 7)] & FLAG_BREAK).toBe(FLAG_BREAK)
    expect(d.breakCells).toBeLessThanOrEqual(8 * 7) // solo las celdas alrededor del pico y sus vecinos
  })

  it('una inversión inyectada en el eje de grises se detecta', () => {
    const n = 33
    const lut = smoothLut(n)
    const i = at(n, 20, 20, 20)
    for (let c = 0; c < 3; c++) lut.data[i * 3 + c] -= 0.08 // más oscuro que el nodo anterior del eje
    const d = analyzeLut(lut)
    expect(d.grayInversions).toBeGreaterThan(0)
    expect(d.nodeFlags[i] & FLAG_INVERSION).toBe(FLAG_INVERSION)
    expect(d.nodeFlags[at(n, 19, 19, 19)] & FLAG_INVERSION).toBe(FLAG_INVERSION)
    expect(d.inversionCells).toBeGreaterThan(0)
    expect(d.worstInversion).toBeGreaterThan(0.01)
  })

  it('luminancia que decrece en toda una dirección no es inversión; una que sube y baja sí', () => {
    const n = 17
    const make = (bump: number) => {
      const data = new Float32Array(n * n * n * 3)
      for (let b = 0; b < n; b++)
        for (let g = 0; g < n; g++)
          for (let r = 0; r < n; r++) {
            const [x, y, z] = [r, g, b].map((v) => v / (n - 1))
            // subir B baja la luminancia en todo el cubo (como el azul de un gamut amplio); el gris sube
            const v = 0.3 + 0.35 * x + 0.35 * y - 0.15 * z + bump * Math.sin(Math.PI * z)
            data.fill(v, at(n, r, g, b) * 3, at(n, r, g, b) * 3 + 3)
          }
      return { kind: '3D' as const, size: n, data, domainMin: [0, 0, 0] as [number, number, number], domainMax: [1, 1, 1] as [number, number, number] }
    }
    const mono = analyzeLut(make(0))
    expect(mono.inversionCells).toBe(0)
    expect(mono.grayInversions).toBe(0)
    const bumpy = analyzeLut(make(0.12)) // a lo largo de B sube y después baja
    expect(bumpy.inversionCells).toBeGreaterThan(0)
  })

  it('recorte y fracción de píxeles en celdas con problemas', () => {
    const n = 9
    const lut = smoothLut(n)
    lut.data[at(n, 8, 8, 8) * 3] = 1.2
    const d = analyzeLut(lut)
    expect(d.nodeFlags[at(n, 8, 8, 8)] & FLAG_CLIP_HIGH).toBe(FLAG_CLIP_HIGH)
    expect(d.clipHighCells).toBe(1)
    // píxeles: la mitad cae en la celda de la esquina blanca
    const px = new Float32Array([0.99, 0.99, 0.99, 0.1, 0.2, 0.3])
    const s = pixelStats(d.nodeFlags, n, px)
    expect(s.samples).toBe(2)
    expect(s.clipHigh).toBe(0.5)
    expect(s.break).toBe(0)
  })
})
