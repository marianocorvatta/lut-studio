import { describe, expect, it } from 'vitest'
import { evalGrade, prepareGrade, wheelDir } from './grade'
import { defaultParams, type WheelName } from './params'
import { cbcrAngle, cbcrToCanvas, hueColor, LUMA_709, REC709_VECTORS, rgbToCbCr, SKIN_LINE_ANGLE, skinLineEnd, YIQ, yiqIAxis } from './vectors'

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

describe('vectores Rec.709 (ruedas y vectorscopio)', () => {
  it('los ángulos salen de la matemática Y\'CbCr Rec.709', () => {
    // Rec.709 (Kr 0.2126, Kb 0.0722), calculados a mano a partir de las ecuaciones
    const expected = { R: 102.91, Mg: 49.68, B: 354.76, Cy: 282.91, G: 229.68, Yl: 174.76 }
    for (const v of REC709_VECTORS) expect(angleDiff(v.angle, expected[v.name])).toBeLessThan(0.01)
    // complementarios opuestos
    const by = Object.fromEntries(REC709_VECTORS.map((v) => [v.name, v.angle]))
    for (const [a, b] of [['R', 'Cy'], ['G', 'Mg'], ['B', 'Yl']]) expect(angleDiff(by[a], by[b])).toBeCloseTo(180, 6)
  })

  it('los ángulos clásicos 103/61/347/283/241/167 son los del U/V analógico (Rec.601), no Rec.709', () => {
    const kr = 0.299
    const kb = 0.114
    const ang601 = (c: [number, number, number]) => {
      const y = kr * c[0] + (1 - kr - kb) * c[1] + kb * c[2]
      return cbcrAngle(0.492 * (c[2] - y), 0.877 * (c[0] - y)) // U, V de NTSC/PAL
    }
    const classic = { R: 103, Mg: 61, B: 347, Cy: 283, G: 241, Yl: 167 }
    for (const v of REC709_VECTORS) expect(angleDiff(ang601(v.rgb), classic[v.name])).toBeLessThan(0.5)
  })

  it('la rueda es la inversa del vectorscopio: empujar hacia una marca da la dirección RGB de ese color', () => {
    for (const v of REC709_VECTORS) {
      const d = wheelDir({ x: v.cb, y: v.cr })
      const y = LUMA_709[0] * v.rgb[0] + LUMA_709[1] * v.rgb[1] + LUMA_709[2] * v.rgb[2]
      for (let c = 0; c < 3; c++) expect(d[c]).toBeCloseTo(v.rgb[c] - y, 3)
      // sin cambio de luma
      expect(LUMA_709[0] * d[0] + LUMA_709[1] * d[1] + LUMA_709[2] * d[2]).toBeCloseTo(0, 3)
    }
  })

  it('el color del anillo en cada ángulo cae en ese mismo ángulo del vectorscopio', () => {
    for (let deg = 0; deg < 360; deg += 3) {
      const [cb, cr] = rgbToCbCr(hueColor(deg))
      expect(angleDiff(cbcrAngle(cb, cr), deg)).toBeLessThan(0.05)
    }
    for (const v of REC709_VECTORS) {
      const c = hueColor(v.angle)
      expect(Math.max(...c)).toBeLessThanOrEqual(1)
      expect(Math.min(...c)).toBeGreaterThanOrEqual(0)
    }
  })

  it('el grade con la rueda empujada hacia una marca mueve un gris en el ángulo de esa marca', () => {
    const cases: [WheelName, number, number][] = [
      ['lift', 1, 0.05],
      ['gain', 1, 0.05],
      ['offset', 1, 0.05],
      ['gamma', 0.3, 1.5], // potencia: no lineal, la dirección es aproximada
    ]
    for (const [wheel, push, tol] of cases)
      for (const v of REC709_VECTORS) {
        const p = defaultParams()
        const a = (v.angle * Math.PI) / 180
        p.grade[wheel] = { ...p.grade[wheel], x: Math.cos(a) * push, y: Math.sin(a) * push }
        const out = evalGrade(prepareGrade(p), [0.5, 0.5, 0.5])
        const [cb, cr] = rgbToCbCr(out)
        expect(Math.hypot(cb, cr)).toBeGreaterThan(0.01)
        expect(angleDiff(cbcrAngle(cb, cr), v.angle), `${wheel} → ${v.name}`).toBeLessThan(tol)
      }
  })
})

describe('línea de tono de piel', () => {
  it('es el eje I de YIQ: Y = 0, Q = 0, I > 0', () => {
    const d = yiqIAxis()
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    expect(dot(YIQ.Y, d)).toBeCloseTo(0, 12)
    expect(dot(YIQ.Q, d)).toBeCloseTo(0, 12)
    expect(dot(YIQ.I, d)).toBeGreaterThan(0)
  })

  it('en el U/V analógico da los 123° clásicos; con la matemática Rec.709 del vectorscopio, 130.4°', () => {
    const d = yiqIAxis()
    const y601 = 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2]
    expect(angleDiff(cbcrAngle(0.492 * (d[2] - y601), 0.877 * (d[0] - y601)), 123)).toBeLessThan(0.5)
    expect(SKIN_LINE_ANGLE).toBeCloseTo(130.45, 1)
    // misma dirección que la de un color de piel típico desplazado desde un gris, medido con rgbToCbCr
    const k = 0.4
    const [cb, cr] = rgbToCbCr([0.5 + k * d[0], 0.5 + k * d[1], 0.5 + k * d[2]])
    expect(angleDiff(cbcrAngle(cb, cr), SKIN_LINE_ANGLE)).toBeLessThan(1e-9)
  })

  it('el ángulo dibujado coincide con el calculado y llega del centro al borde', () => {
    for (const S of [256, 300]) {
      const [x, y] = skinLineEnd(S)
      const drawn = cbcrAngle(x - S / 2, S / 2 - y) // canvas: y hacia abajo
      expect(angleDiff(drawn, SKIN_LINE_ANGLE)).toBeLessThan(1e-9)
      expect(Math.hypot(x - S / 2, y - S / 2)).toBeCloseTo(S / 2, 9)
    }
    // los objetivos de color usan la misma proyección
    const r = REC709_VECTORS[0]
    const [x, y] = cbcrToCanvas(r.cb, r.cr, 256)
    expect(angleDiff(cbcrAngle(x - 128, 128 - y), r.angle)).toBeLessThan(1e-9)
  })
})
