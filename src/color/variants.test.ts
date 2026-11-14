import { describe, expect, it } from 'vitest'
import { exportNames } from '../ui/exportNames'
import { identityLut3D, sampleLut3D, type Interpolation, type Lut3D } from './lut'
import { defaultParams, type LookParams } from './params'
import { bakeCpu, prepare } from './pipeline'
import { inputIsNeutral, lookOnlyParams, prepareConversion, prepareLookOnly } from './variants'

let seed = 99
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)

/** LUT de conversión sintético, suave y dentro de 0..1 (hace las veces del LUT de Apple). */
function convLut(n: number): Lut3D {
  const lut = identityLut3D(n)
  for (let i = 0; i < lut.data.length; i += 3) {
    const [r, g, b] = [lut.data[i], lut.data[i + 1], lut.data[i + 2]]
    lut.data[i] = Math.fround(0.05 + 0.9 * (0.8 * r + 0.15 * g + 0.05 * b) ** 0.8)
    lut.data[i + 1] = Math.fround(0.05 + 0.9 * (0.1 * r + 0.8 * g + 0.1 * b) ** 0.8)
    lut.data[i + 2] = Math.fround(0.05 + 0.9 * (0.05 * r + 0.15 * g + 0.8 * b) ** 0.8)
  }
  return lut
}

/** Compara el LUT completo con conversión -> look en cadena, en puntos al azar. */
function chainError(params: LookParams, luts: { conversionLut: Lut3D; creativeLut: Lut3D | null }, n: number, interp: Interpolation) {
  const full = bakeCpu(prepare(params, luts, interp), n) as Lut3D
  const conv = bakeCpu(prepareConversion(params, luts, interp, false)!, n) as Lut3D
  const look = bakeCpu(prepareLookOnly(params, luts, interp), n) as Lut3D
  let max = 0
  let sum = 0
  const N = 40000
  for (let i = 0; i < N; i++) {
    const x = [rnd(), rnd(), rnd()]
    const a = sampleLut3D(full, x, interp)
    const b = sampleLut3D(look, sampleLut3D(conv, x, interp), interp)
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[c] - b[c])
      max = Math.max(max, d)
      sum += d
    }
  }
  return { max, mean: sum / (N * 3) }
}

describe('exportar solo el look', () => {
  it('el look solo no lleva conversión ni etapa de entrada, y conserva todo lo creativo', () => {
    const p = defaultParams()
    p.input.exposure = 1.5
    p.grade.contrast = 1.3
    p.creativeLut.intensity = 0.4
    const lo = lookOnlyParams(p)
    expect(lo.conversion.enabled).toBe(false)
    expect(inputIsNeutral(lo)).toBe(true)
    expect(inputIsNeutral(p)).toBe(false)
    expect(lo.grade).toEqual(p.grade)
    expect(lo.creativeLut).toEqual(p.creativeLut)
    expect(lo.output).toEqual(p.output)
  })

  it('con un look afín (gain y offset por canal) la cadena coincide exactamente con el LUT completo', () => {
    const p = defaultParams()
    p.output.clamp = false
    p.grade.gain = { x: 0.1, y: -0.05, master: 1.1 }
    p.grade.offset = { x: -0.03, y: 0.02, master: 0.01 }
    for (const interp of ['tetrahedral', 'trilinear'] as const) {
      const e = chainError(p, { conversionLut: convLut(33), creativeLut: null }, 33, interp)
      expect(e.max).toBeLessThan(2e-6)
    }
  })

  it('look no lineal con LUT creativo: la diferencia es error de interpolación (baja de 33 a 65)', () => {
    const p = defaultParams()
    p.grade.contrast = 1.25
    p.grade.saturation = 1.2
    p.grade.gain = { x: 0.05, y: 0.02, master: 1.05 }
    p.curves.master = [
      { x: 0, y: 0 },
      { x: 0.3, y: 0.25 },
      { x: 0.7, y: 0.78 },
      { x: 1, y: 1 },
    ]
    const creative = convLut(17)
    p.creativeLut = { enabled: true, intensity: 0.6 }
    const luts = { conversionLut: convLut(33), creativeLut: creative }
    const e33 = chainError(p, luts, 33, 'tetrahedral')
    const e65 = chainError(p, luts, 65, 'tetrahedral')
    // medido (tetraédrica): 33³ máx 0.087, prom 1.07e-3; 65³ máx 0.058, prom 3.9e-4. El máximo aparece donde el look
    // es más curvo (cerca del negro en colores saturados); el promedio baja ~2.7x al duplicar la resolución
    expect(e33.mean).toBeLessThan(2e-3)
    expect(e33.max).toBeLessThan(0.15)
    expect(e65.mean).toBeLessThan(e33.mean * 0.5)
    expect(e65.max).toBeLessThan(e33.max)
  })

  it('nombre de archivo y TITLE indican el tipo', () => {
    expect(exportNames('MiLook', 'look', 33)).toEqual({ file: 'MiLook_look-only_Rec709_33.cube', title: 'MiLook_look-only_Rec709' })
    expect(exportNames('MiLook', 'full', 65)).toEqual({ file: 'MiLook_full_AppleLog2-to-Rec709_65.cube', title: 'MiLook_full_AppleLog2-to-Rec709' })
    expect(exportNames('MiLook', 'full', 33, false).title).toBe('MiLook_full')
    // nombre elegido: se usa tal cual (sin duplicar .cube y sin caracteres inválidos) para el archivo y el TITLE
    expect(exportNames('MiLook', 'look', 33, true, '  Verano 2026 ')).toEqual({ file: 'Verano 2026.cube', title: 'Verano 2026' })
    expect(exportNames('MiLook', 'full', 33, true, 'a/b:c.cube')).toEqual({ file: 'a_b_c.cube', title: 'a_b_c' })
    expect(exportNames('MiLook', 'full', 33, true, '   ').file).toBe('MiLook_full_AppleLog2-to-Rec709_33.cube')
  })
})
