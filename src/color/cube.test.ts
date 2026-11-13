import { describe, expect, it } from 'vitest'
import { CubeParseError, parseCube, writeCube } from './cube'
import { applyLutStack, identityLut3D, sampleLut, sampleLut3D, type Lut3D } from './lut'

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

describe('parser .cube', () => {
  it('lee cabecera, comentarios, líneas vacías y CRLF', () => {
    const text =
      '﻿TITLE "Mi LUT"\r\n# comentario\r\n\r\nLUT_3D_SIZE 2\r\nDOMAIN_MIN 0 0 0\r\nDOMAIN_MAX 1 1 1\r\n\r\n' +
      '0 0 0\r\n1 0 0\r\n0 1 0\r\n1 1 0\r\n0 0 1\r\n1 0 1\r\n0 1 1\r\n1 1 1\r\n'
    const lut = parseCube(text)
    expect(lut.kind).toBe('3D')
    expect(lut.size).toBe(2)
    expect(lut.title).toBe('Mi LUT')
    expect(Array.from(lut.data.slice(3, 6))).toEqual([1, 0, 0]) // el rojo varía primero
    expect(Array.from(lut.data.slice(12, 15))).toEqual([0, 0, 1]) // el azul, último
  })

  it('lee LUT 1D, notación científica y LUT_1D_INPUT_RANGE', () => {
    const lut = parseCube('LUT_1D_SIZE 3\nLUT_1D_INPUT_RANGE 0.0 2.0\n0 0 0\n5e-1 0.5 .5\n1 1 1')
    expect(lut.kind).toBe('1D')
    expect(lut.domainMax).toEqual([2, 2, 2])
    expect(sampleLut(lut, [0.5, 1, 2], 'trilinear')).toEqual([0.25, 0.5, 1])
  })

  it('rechaza archivos inválidos con número de línea', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n')).toThrow(CubeParseError)
    expect(() => parseCube('0 0 0\n')).toThrow(/faltan LUT_3D_SIZE/)
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0\n')).toThrow(/Línea 2/)
    expect(() => parseCube('LUT_3D_SIZE 2\nFOO 1\n')).toThrow(/desconocida/)
    expect(() => parseCube('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n2 2 2\n')).toThrow(/más filas/)
  })
})

describe('writer .cube', () => {
  it('escribe cabecera estándar y 6 decimales', () => {
    const out = writeCube(identityLut3D(2), { title: 'Prueba' })
    const lines = out.split('\n')
    expect(lines[0]).toBe('TITLE "Prueba"')
    expect(lines[1]).toBe('LUT_3D_SIZE 2')
    expect(lines[2]).toBe('DOMAIN_MIN 0 0 0')
    expect(lines[3]).toBe('DOMAIN_MAX 1 1 1')
    expect(lines[4]).toBe('0.000000 0.000000 0.000000')
    expect(lines[5]).toBe('1.000000 0.000000 0.000000')
  })

  it.each([33, 65])('ida y vuelta sin pérdida (N=%i)', (n) => {
    const rand = rng(n)
    const lut = identityLut3D(n)
    // valores arbitrarios con 6 decimales, incluyendo fuera de [0,1]
    for (let i = 0; i < lut.data.length; i++) lut.data[i] = Math.round((rand() * 1.4 - 0.2) * 1e6) / 1e6
    const text1 = writeCube(lut, { title: 'rt' })
    const back = parseCube(text1)
    expect(back.size).toBe(n)
    expect(back.data).toEqual(lut.data)
    expect(writeCube(back, { title: 'rt' })).toBe(text1)
  })
})

describe('writer .cube exacto', () => {
  it('precision "exact" vuelve bit a bit, incluso con valores muy chicos', () => {
    const lut = identityLut3D(9)
    const rand = rng(99)
    for (let i = 0; i < lut.data.length; i++) lut.data[i] = (rand() - 0.3) * 10 ** -Math.floor(rand() * 8)
    const back = parseCube(writeCube(lut, { precision: 'exact' }))
    expect(back.data).toEqual(lut.data)
  })
})

describe('muestreo de LUT en CPU', () => {
  it.each(['trilinear', 'tetrahedral'] as const)('un LUT identidad deja la imagen idéntica (%s)', (interp) => {
    const rand = rng(7)
    for (const n of [2, 17, 33, 65]) {
      const lut = parseCube(writeCube(identityLut3D(n)))
      let worst = 0
      for (let i = 0; i < 2000; i++) {
        const px = [rand(), rand(), rand()]
        const out = sampleLut(lut, px, interp)
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(out[c] - px[c]))
      }
      expect(worst).toBeLessThan(2e-6)
    }
  })

  it('devuelve los nodos exactos de la grilla', () => {
    const rand = rng(3)
    const lut = identityLut3D(5)
    for (let i = 0; i < lut.data.length; i++) lut.data[i] = rand()
    const m = 4
    let worst = 0
    for (const interp of ['trilinear', 'tetrahedral'] as const)
      for (let b = 0; b <= m; b++)
        for (let g = 0; g <= m; g++)
          for (let r = 0; r <= m; r++) {
            const o = (r + 5 * (g + 5 * b)) * 3
            const out = sampleLut3D(lut, [r / m, g / m, b / m], interp)
            for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(out[c] - lut.data[o + c]))
          }
    expect(worst).toBeLessThan(1e-6)
  })

  it('trilineal y tetraédrica coinciden en una función afín y difieren fuera de ella', () => {
    const n = 9
    const lut: Lut3D = identityLut3D(n)
    for (let i = 0; i < lut.data.length; i += 3) {
      const [r, g, b] = [lut.data[i], lut.data[i + 1], lut.data[i + 2]]
      lut.data[i] = 0.2 * r + 0.5 * g - 0.1 * b + 0.05
      lut.data[i + 1] = r * g * b // no afín
      lut.data[i + 2] = b
    }
    const a = sampleLut3D(lut, [0.31, 0.62, 0.17], 'trilinear')
    const t = sampleLut3D(lut, [0.31, 0.62, 0.17], 'tetrahedral')
    expect(a[0]).toBeCloseTo(t[0], 6)
    expect(a[0]).toBeCloseTo(0.2 * 0.31 + 0.5 * 0.62 - 0.1 * 0.17 + 0.05, 6)
    expect(Math.abs(a[1] - t[1])).toBeGreaterThan(1e-5) // difieren fuera de lo afín
  })

  it('pila con opacidad y dominio', () => {
    const inv = identityLut3D(2)
    for (let i = 0; i < inv.data.length; i++) inv.data[i] = 1 - inv.data[i]
    expect(applyLutStack([{ lut: inv, opacity: 0.5 }], [0.2, 0.4, 1], 'tetrahedral').map((v) => +v.toFixed(6))).toEqual([0.5, 0.5, 0.5])
    expect(applyLutStack([{ lut: inv, opacity: 1 }, { lut: inv, opacity: 1 }], [0.2, 0.4, 1], 'trilinear')[0]).toBeCloseTo(0.2, 6)
    const wide: Lut3D = { ...identityLut3D(2), domainMin: [0, 0, 0], domainMax: [2, 2, 2] }
    expect(sampleLut3D(wide, [1, 2, 3], 'trilinear')).toEqual([0.5, 1, 1])
  })
})
