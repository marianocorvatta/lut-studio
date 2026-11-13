/**
 * Tipos y muestreo de LUTs en CPU (referencia). Matemática pura, sin APIs de navegador.
 *
 * Orden de datos de un LUT 3D (estándar .cube): el rojo varía más rápido,
 * después el verde y por último el azul:  index = (r + n * (g + n * b)) * 3
 */

export type Interpolation = 'trilinear' | 'tetrahedral'

export interface Lut3D {
  kind: '3D'
  size: number
  /** n^3 * 3 valores RGB */
  data: Float32Array
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  title?: string
}

export interface Lut1D {
  kind: '1D'
  size: number
  /** n * 3 valores RGB */
  data: Float32Array
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  title?: string
}

export type Lut = Lut3D | Lut1D

export type RGB = [number, number, number]

export function identityLut3D(size: number): Lut3D {
  const data = new Float32Array(size * size * size * 3)
  const m = size - 1
  let o = 0
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        data[o++] = r / m
        data[o++] = g / m
        data[o++] = b / m
      }
  return { kind: '3D', size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Muestreo de un LUT 3D. Escribe el resultado en `out` y lo devuelve. */
export function sampleLut3D(lut: Lut3D, rgb: ArrayLike<number>, interp: Interpolation, out: RGB = [0, 0, 0]): RGB {
  const n = lut.size
  const d = lut.data
  const m = n - 1
  const { domainMin: lo, domainMax: hi } = lut
  const pr = clamp01((rgb[0] - lo[0]) / (hi[0] - lo[0])) * m
  const pg = clamp01((rgb[1] - lo[1]) / (hi[1] - lo[1])) * m
  const pb = clamp01((rgb[2] - lo[2]) / (hi[2] - lo[2])) * m
  const ir = Math.min(Math.floor(pr), n - 2)
  const ig = Math.min(Math.floor(pg), n - 2)
  const ib = Math.min(Math.floor(pb), n - 2)
  const fr = pr - ir
  const fg = pg - ig
  const fb = pb - ib
  const sR = 3
  const sG = 3 * n
  const sB = 3 * n * n
  const o000 = (ir + n * (ig + n * ib)) * 3
  const o100 = o000 + sR
  const o010 = o000 + sG
  const o110 = o010 + sR
  const o001 = o000 + sB
  const o101 = o001 + sR
  const o011 = o001 + sG
  const o111 = o011 + sR

  if (interp === 'trilinear') {
    for (let c = 0; c < 3; c++) {
      const c00 = d[o000 + c] + (d[o100 + c] - d[o000 + c]) * fr
      const c10 = d[o010 + c] + (d[o110 + c] - d[o010 + c]) * fr
      const c01 = d[o001 + c] + (d[o101 + c] - d[o001 + c]) * fr
      const c11 = d[o011 + c] + (d[o111 + c] - d[o011 + c]) * fr
      const c0 = c00 + (c10 - c00) * fg
      const c1 = c01 + (c11 - c01) * fg
      out[c] = c0 + (c1 - c0) * fb
    }
    return out
  }

  // Tetraédrica: mismos 6 tetraedros y mismo orden de comparación que el shader.
  let oa: number, ob: number, fa: number, fm: number, fz: number
  if (fr > fg) {
    if (fg > fb) { oa = o100; ob = o110; fa = fr; fm = fg; fz = fb }
    else if (fr > fb) { oa = o100; ob = o101; fa = fr; fm = fb; fz = fg }
    else { oa = o001; ob = o101; fa = fb; fm = fr; fz = fg }
  } else {
    if (fb > fg) { oa = o001; ob = o011; fa = fb; fm = fg; fz = fr }
    else if (fb > fr) { oa = o010; ob = o011; fa = fg; fm = fb; fz = fr }
    else { oa = o010; ob = o110; fa = fg; fm = fr; fz = fb }
  }
  for (let c = 0; c < 3; c++) {
    const v0 = d[o000 + c]
    const va = d[oa + c]
    const vb = d[ob + c]
    out[c] = v0 + fa * (va - v0) + fm * (vb - va) + fz * (d[o111 + c] - vb)
  }
  return out
}

/** Muestreo de un LUT 1D (interpolación lineal por canal). */
export function sampleLut1D(lut: Lut1D, rgb: ArrayLike<number>, out: RGB = [0, 0, 0]): RGB {
  const n = lut.size
  const d = lut.data
  const { domainMin: lo, domainMax: hi } = lut
  for (let c = 0; c < 3; c++) {
    const p = clamp01((rgb[c] - lo[c]) / (hi[c] - lo[c])) * (n - 1)
    const i = Math.min(Math.floor(p), n - 2)
    const f = p - i
    const a = d[i * 3 + c]
    out[c] = a + (d[(i + 1) * 3 + c] - a) * f
  }
  return out
}

export function sampleLut(lut: Lut, rgb: ArrayLike<number>, interp: Interpolation, out: RGB = [0, 0, 0]): RGB {
  return lut.kind === '3D' ? sampleLut3D(lut, rgb, interp, out) : sampleLut1D(lut, rgb, out)
}

export interface LutLayer {
  lut: Lut
  /** 0..1 */
  opacity: number
}

/** Aplica una pila de LUTs en orden, con mezcla por opacidad. Sin clamp intermedio. */
export function applyLutStack(layers: readonly LutLayer[], rgb: ArrayLike<number>, interp: Interpolation): RGB {
  const cur: RGB = [rgb[0], rgb[1], rgb[2]]
  const tmp: RGB = [0, 0, 0]
  for (const layer of layers) {
    sampleLut(layer.lut, cur, interp, tmp)
    const k = layer.opacity
    cur[0] += (tmp[0] - cur[0]) * k
    cur[1] += (tmp[1] - cur[1]) * k
    cur[2] += (tmp[2] - cur[2]) * k
  }
  return cur
}
