import { describe, expect, it } from 'vitest'
import {
  APPLE_LOG_PT,
  appleLogDecode,
  appleLogEncode,
  AWG_TO_REC709,
  bradford,
  formulaToneMap,
  inputMatrix,
  REC709_TO_XYZ,
  whiteXY,
} from './appleLog'
import { APPLE_LOG_CURVE as K } from './appleLog2.constants'
import { identity3, invert3, mul3, mulVec3 } from './mat3'
import { defaultParams } from './params'
import { bakeCpu, CONV_FORMULA, CONV_LUT, CONV_OFF, evalPipeline, prepare } from './pipeline'
import { identityLut3D } from './lut'

describe('curva Apple Log', () => {
  it('valores característicos de la curva', () => {
    expect(appleLogDecode(0)).toBeCloseTo(K.R0, 12)
    expect(appleLogDecode(-1)).toBe(K.R0)
    expect(appleLogDecode(APPLE_LOG_PT)).toBeCloseTo(K.Rt, 6) // continuidad en el empalme
    expect(appleLogDecode(1)).toBeCloseTo(2 ** ((1 - K.delta) / K.gamma) - K.beta, 12)
    expect(appleLogEncode(0.18)).toBeCloseTo(0.4882, 3) // gris 18 %
    expect(appleLogEncode(K.R0 - 1)).toBe(0)
  })

  it('es continua y monótona, y encode(decode(x)) = x', () => {
    let prev = -Infinity
    for (let i = 0; i <= 2000; i++) {
      const p = i / 2000
      const r = appleLogDecode(p)
      expect(r).toBeGreaterThanOrEqual(prev)
      prev = r
      expect(appleLogEncode(r)).toBeCloseTo(p, 9)
    }
    const eps = 1e-9
    expect(Math.abs(appleLogDecode(APPLE_LOG_PT + eps) - appleLogDecode(APPLE_LOG_PT - eps))).toBeLessThan(1e-6)
    expect(Math.abs(appleLogEncode(K.Rt + eps) - appleLogEncode(K.Rt - eps))).toBeLessThan(1e-6)
  })
})

describe('matrices de gamut y balance de blancos', () => {
  it('Rec.709 -> XYZ coincide con la matriz estándar', () => {
    const std = [0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505]
    REC709_TO_XYZ.forEach((v, i) => expect(v).toBeCloseTo(std[i], 3))
  })

  it('AWG -> Rec.709 conserva el blanco (filas suman 1) y es más amplio que Rec.709', () => {
    for (let r = 0; r < 3; r++) expect(AWG_TO_REC709[r * 3] + AWG_TO_REC709[r * 3 + 1] + AWG_TO_REC709[r * 3 + 2]).toBeCloseTo(1, 10)
    // un rojo puro de AWG cae fuera de Rec.709 (componentes negativas)
    const red = mulVec3(AWG_TO_REC709, [1, 0, 0])
    expect(red[0]).toBeGreaterThan(1)
    expect(red[1]).toBeLessThan(0)
    const round = mul3(invert3(AWG_TO_REC709), AWG_TO_REC709)
    identity3().forEach((v, i) => expect(round[i]).toBeCloseTo(v, 10))
  })

  it('la etapa de entrada es la identidad exacta en los valores por defecto', () => {
    expect(inputMatrix(0, 6500, 0)).toEqual(identity3())
    expect(inputMatrix(1, 6500, 0)).toEqual([2, 0, 0, 0, 2, 0, 0, 0, 2])
  })

  it('Bradford: identidad con el mismo blanco, y el blanco de origen va al de destino', () => {
    const a = whiteXY(3200, 0)
    const b = whiteXY(6500, 0)
    bradford(b, b).forEach((v, i) => expect(v).toBeCloseTo(identity3()[i], 12))
    const out = mulVec3(bradford(a, b), [a[0] / a[1], 1, (1 - a[0] - a[1]) / a[1]])
    expect(out[0] / (out[0] + out[1] + out[2])).toBeCloseTo(b[0], 9)
    expect(out[1] / (out[0] + out[1] + out[2])).toBeCloseTo(b[1], 9)
  })

  it('el lugar de Planck pasa cerca de D65 y el tinte + es verde', () => {
    const [x, y] = whiteXY(6500, 0)
    expect(x).toBeCloseTo(0.3135, 3)
    expect(y).toBeCloseTo(0.3237, 3)
    expect(whiteXY(6500, 50)[1]).toBeGreaterThan(y)
  })

  it('subir la temperatura calienta, subir el tinte va a magenta, y es continuo cerca del neutro', () => {
    const warm = mulVec3(inputMatrix(0, 9000, 0), [1, 1, 1])
    expect(warm[0]).toBeGreaterThan(warm[2])
    const cool = mulVec3(inputMatrix(0, 4000, 0), [1, 1, 1])
    expect(cool[2]).toBeGreaterThan(cool[0])
    const magenta = mulVec3(inputMatrix(0, 6500, 40), [1, 1, 1])
    expect(magenta[1]).toBeLessThan(magenta[0])
    expect(magenta[1]).toBeLessThan(magenta[2])
    const near = inputMatrix(0, 6501, 0)
    near.forEach((v, i) => expect(Math.abs(v - identity3()[i])).toBeLessThan(1e-3))
  })
})

describe('pipeline: conversión', () => {
  const noRes = { conversionLut: null, creativeLut: null }

  it('tone mapping de la fórmula: negro, blanco y monotonía', () => {
    expect(formulaToneMap(-0.05)).toBe(0)
    expect(formulaToneMap(0)).toBe(0)
    expect(formulaToneMap(12)).toBeCloseTo(1, 12)
    let prev = -1
    for (let i = 0; i <= 600; i++) {
      const v = formulaToneMap(i / 50)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    expect(formulaToneMap(0.18)).toBeGreaterThan(0.45)
    expect(formulaToneMap(0.18)).toBeLessThan(0.6)
  })

  it('modos de conversión', () => {
    const p = defaultParams()
    expect(prepare(p, noRes, 'tetrahedral').convMode).toBe(CONV_OFF) // sin LUT cargado
    expect(prepare(p, noRes, 'tetrahedral').issues).toHaveLength(1)
    expect(prepare(p, { ...noRes, conversionLut: identityLut3D(2) }, 'tetrahedral').convMode).toBe(CONV_LUT)
    p.conversion.source = 'formula'
    expect(prepare(p, noRes, 'tetrahedral').convMode).toBe(CONV_FORMULA)
    p.conversion.enabled = false
    p.input.exposure = 2
    const off = prepare(p, noRes, 'tetrahedral')
    expect(off.convMode).toBe(CONV_OFF)
    expect(off.inputOn).toBe(false) // sin conversión no hay etapa de entrada
    expect(bakeCpu(off, 5).data).toEqual(identityLut3D(5).data)
  })

  it('fórmula: el eje neutro queda neutro y +1 stop equivale a duplicar el lineal', () => {
    const p = defaultParams()
    p.conversion.source = 'formula'
    const base = prepare(p, noRes, 'tetrahedral')
    const out = evalPipeline(base, [0.5, 0.5, 0.5])
    expect(out[0]).toBeCloseTo(out[1], 9)
    expect(out[1]).toBeCloseTo(out[2], 9)
    expect(evalPipeline(base, [0, 0, 0])).toEqual([0, 0, 0])
    expect(evalPipeline(base, [1, 1, 1])[1]).toBeCloseTo(1, 9)

    p.input.exposure = 1
    const up = evalPipeline(prepare(p, noRes, 'tetrahedral'), [0.4, 0.4, 0.4])
    const x2 = appleLogEncode(2 * appleLogDecode(0.4))
    const ref = evalPipeline(base, [x2, x2, x2])
    expect(up[1]).toBeCloseTo(ref[1], 9)
  })

  it('con .cube: la etapa de entrada actúa sobre la señal log antes del LUT', () => {
    const p = defaultParams()
    p.input.exposure = -1
    const prep = prepare(p, { ...noRes, conversionLut: identityLut3D(33) }, 'tetrahedral')
    expect(prep.inputOn).toBe(true)
    const out = evalPipeline(prep, [0.6, 0.6, 0.6])
    expect(out[0]).toBeCloseTo(appleLogEncode(appleLogDecode(0.6) / 2), 5)
  })
})
