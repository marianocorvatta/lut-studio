import { describe, expect, it } from 'vitest'
import { monotoneSpline, periodicSpline } from './curves'
import { evalGrade, prepareGrade, tonalWeights } from './grade'
import { identityLut3D } from './lut'
import { linearToOklab, oklabToLinear } from './oklab'
import { defaultParams } from './params'
import { bakeCpu, prepare } from './pipeline'

const noRes = { conversionLut: null, creativeLut: null }

describe('splines monótonas', () => {
  it('pasan por los puntos y no hacen overshoot', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0.05 },
      { x: 0.25, y: 0.8 },
      { x: 0.6, y: 0.82 },
      { x: 1, y: 1 },
    ]
    const f = monotoneSpline(pts)
    for (const p of pts) expect(f(p.x)).toBeCloseTo(p.y, 12)
    for (let i = 0; i < pts.length - 1; i++) {
      const lo = Math.min(pts[i].y, pts[i + 1].y)
      const hi = Math.max(pts[i].y, pts[i + 1].y)
      for (let k = 0; k <= 200; k++) {
        const x = pts[i].x + ((pts[i + 1].x - pts[i].x) * k) / 200
        const y = f(x)
        expect(y).toBeGreaterThanOrEqual(lo - 1e-12)
        expect(y).toBeLessThanOrEqual(hi + 1e-12)
      }
    }
  })

  it('con datos monótonos es monótona, y la diagonal da la identidad', () => {
    const f = monotoneSpline([
      { x: 0, y: 0 },
      { x: 0.1, y: 0.4 },
      { x: 0.5, y: 0.45 },
      { x: 1, y: 1 },
    ])
    let prev = -1
    for (let i = 0; i <= 1000; i++) {
      const y = f(i / 1000)
      expect(y).toBeGreaterThanOrEqual(prev)
      prev = y
    }
    const id = monotoneSpline([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ])
    for (let i = 0; i <= 10; i++) expect(id(i / 10)).toBeCloseTo(i / 10, 12)
  })

  it('la periódica es continua al cruzar 1 → 0', () => {
    const f = periodicSpline([
      { x: 0.1, y: 0.5 },
      { x: 0.5, y: -0.5 },
      { x: 0.9, y: 0.2 },
    ])
    expect(f(0.999999)).toBeCloseTo(f(0.000001), 4)
    expect(f(1.1)).toBeCloseTo(f(0.1), 12)
  })
})

describe('Oklab', () => {
  it('ida y vuelta, y el blanco tiene L = 1 sin croma', () => {
    const [L, a, b] = linearToOklab(1, 1, 1)
    expect(L).toBeCloseTo(1, 6)
    expect(Math.hypot(a, b)).toBeLessThan(1e-6)
    for (const c of [
      [0.2, 0.5, 0.9],
      [1.2, -0.05, 0.3],
    ]) {
      const back = oklabToLinear(...linearToOklab(c[0], c[1], c[2]))
      back.forEach((v, i) => expect(v).toBeCloseTo(c[i], 6))
    }
  })

  it('los pesos tonales suman 1', () => {
    for (let i = 0; i <= 20; i++) {
      const w = tonalWeights(i / 20)
      expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 12)
    }
  })
})

describe('etapa creativa', () => {
  it('en neutro es la identidad exacta (ningún paso activo)', () => {
    const g = prepareGrade(defaultParams())
    expect([g.lggOn, g.offsetOn, g.contrastOn, g.curvesOn, g.okOn]).toEqual([false, false, false, false, false])
    expect(bakeCpu(prepare(defaultParams(), noRes, 'tetrahedral'), 9).data).toEqual(identityLut3D(9).data)
  })

  it('lift, gain, offset, contraste y gamma hacen lo esperado', () => {
    const p = defaultParams()
    p.grade.gain.master = 0.5
    expect(evalGrade(prepareGrade(p), [0.8, 0.8, 0.8])[0]).toBeCloseTo(0.4, 12)
    p.grade.gain.master = 1
    p.grade.lift.master = 0.1
    expect(evalGrade(prepareGrade(p), [0, 0, 0])[0]).toBeCloseTo(0.1, 12) // el lift levanta el negro
    expect(evalGrade(prepareGrade(p), [1, 1, 1])[0]).toBeCloseTo(1, 12) // y no toca el blanco
    p.grade.lift.master = 0
    p.grade.offset.master = -0.05
    expect(evalGrade(prepareGrade(p), [0.5, 0.5, 0.5])[0]).toBeCloseTo(0.45, 12)
    p.grade.offset.master = 0
    p.grade.contrast = 1.5
    expect(evalGrade(prepareGrade(p), [p.grade.pivot, 0, 0])[0]).toBeCloseTo(p.grade.pivot, 12)
    p.grade.contrast = 1
    p.grade.gamma.master = 1 // exponente 1/2: aclara los medios
    expect(evalGrade(prepareGrade(p), [0.25, 0.25, 0.25])[0]).toBeCloseTo(0.5, 12)
  })

  it('las ruedas mueven el color sin cambiar la luma Rec.709', () => {
    const p = defaultParams()
    p.grade.offset = { x: 0.3, y: -0.2, master: 0 }
    const c = evalGrade(prepareGrade(p), [0.5, 0.5, 0.5])
    expect(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]).toBeCloseTo(0.5, 4)
    expect(c[2]).toBeGreaterThan(c[0]) // Cb + => más azul
  })

  it('no recorta: valores fuera de [0, 1] sobreviven a las curvas', () => {
    const p = defaultParams()
    p.curves.master = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.6 },
      { x: 1, y: 1 },
    ]
    const g = prepareGrade(p)
    expect(evalGrade(g, [1.2, -0.1, 0.5])[0]).toBeGreaterThan(1)
    expect(evalGrade(g, [1.2, -0.1, 0.5])[1]).toBeLessThan(0)
  })

  it('saturación 0 deja un gris y no cambia la luminancia Oklab', () => {
    const p = defaultParams()
    p.grade.saturation = 0
    const c = evalGrade(prepareGrade(p), [0.7, 0.3, 0.2])
    expect(Math.abs(c[0] - c[1])).toBeLessThan(1e-5)
    expect(Math.abs(c[1] - c[2])).toBeLessThan(1e-5)
    const L0 = linearToOklab(0.7 ** 2.4, 0.3 ** 2.4, 0.2 ** 2.4)[0]
    const L1 = linearToOklab(c[0] ** 2.4, c[1] ** 2.4, c[2] ** 2.4)[0]
    expect(L1).toBeCloseTo(L0, 5)
  })

  it('las curvas de tono no afectan a los grises', () => {
    const p = defaultParams()
    p.hueCurves.hueHue = [{ x: 0.1, y: 0.8 }]
    p.hueCurves.hueLum = [{ x: 0.5, y: -1 }]
    const g = prepareGrade(p)
    const c = evalGrade(g, [0.4, 0.4, 0.4])
    c.forEach((v) => expect(v).toBeCloseTo(0.4, 5))
  })
})
