/** Matrices 3x3 en orden de filas: [m00, m01, m02, m10, m11, m12, m20, m21, m22]. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

export const identity3 = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9) as Mat3
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return o
}

export function mulVec3(m: Mat3, v: ArrayLike<number>): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (det === 0) throw new Error('matriz singular')
  const k = 1 / det
  return [A * k, (c * h - b * i) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, (c * d - a * f) * k, C * k, (b * g - a * h) * k, (a * e - b * d) * k]
}

export const isIdentity3 = (m: Mat3): boolean => m.every((v, i) => v === (i % 4 === 0 ? 1 : 0))
