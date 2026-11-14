import { describe, expect, it } from 'vitest'
import { bradford, rgbToXyzMatrix } from '../color/appleLog'
import { decode24 } from '../color/grade'
import { mul3 } from '../color/mat3'
import { displayConversion, extractICC, parseICC } from './icc'

type XY = [number, number]
const D65: XY = [0.3127, 0.329]
const D50_XYZ = [0.9642, 1, 0.8249]
const D50: XY = [D50_XYZ[0] / (D50_XYZ[0] + 1 + D50_XYZ[2]), 1 / (D50_XYZ[0] + 1 + D50_XYZ[2])]

/** Perfil ICC v2 de matriz y curvas (curva paramétrica de sRGB), como los de las cámaras y los navegadores. */
function makeIcc(primaries: [XY, XY, XY], desc: string): Uint8Array {
  const m = mul3(bradford(D65, D50), rgbToXyzMatrix(primaries[0], primaries[1], primaries[2], D65))
  const tags: [string, Uint8Array][] = []
  const s15 = (v: number) => {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setInt32(0, Math.round(v * 65536))
    return b
  }
  const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
    let o = 0
    for (const p of parts) {
      out.set(p, o)
      o += p.length
    }
    return out
  }
  const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
  const xyzTag = (col: number) => cat(ascii('XYZ '), new Uint8Array(4), s15(m[col]), s15(m[3 + col]), s15(m[6 + col]))
  // para tipo 3: Y = (aX + b)^g si X >= d, si no cX  (la curva de sRGB)
  const para = cat(ascii('para'), new Uint8Array(4), Uint8Array.of(0, 3, 0, 0), ...[2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045].map(s15))
  const descTag = cat(ascii('desc'), new Uint8Array(4), Uint8Array.of(0, 0, 0, desc.length + 1), ascii(desc), new Uint8Array(1 + 67 + 12))
  tags.push(['rXYZ', xyzTag(0)], ['gXYZ', xyzTag(1)], ['bXYZ', xyzTag(2)], ['rTRC', para], ['gTRC', para], ['bTRC', para], ['desc', descTag])
  const header = new Uint8Array(128)
  const hv = new DataView(header.buffer)
  header.set(ascii('mntr'), 12)
  header.set(ascii('RGB '), 16)
  header.set(ascii('XYZ '), 20)
  header.set(ascii('acsp'), 36)
  D50_XYZ.forEach((v, i) => hv.setInt32(68 + i * 4, Math.round(v * 65536)))
  const table = new Uint8Array(4 + tags.length * 12)
  const tv = new DataView(table.buffer)
  tv.setUint32(0, tags.length)
  let off = 128 + table.length
  const pad = (b: Uint8Array) => cat(b, new Uint8Array((4 - (b.length % 4)) % 4))
  const bodies: Uint8Array[] = []
  tags.forEach(([sig, body], i) => {
    table.set(ascii(sig), 4 + i * 12)
    tv.setUint32(4 + i * 12 + 4, off)
    tv.setUint32(4 + i * 12 + 8, body.length)
    const p = pad(body)
    bodies.push(p)
    off += p.length
  })
  const icc = cat(header, table, ...bodies)
  new DataView(icc.buffer).setUint32(0, icc.length)
  return icc
}

/** JPEG mínimo con el perfil partido en dos segmentos APP2 (como hacen las cámaras con perfiles grandes). */
function jpegWith(icc: Uint8Array): ArrayBuffer {
  const half = Math.ceil(icc.length / 2)
  const seg = (seq: number, data: Uint8Array) => {
    const head = Uint8Array.from('ICC_PROFILE\0', (c) => c.charCodeAt(0))
    const len = 2 + head.length + 2 + data.length
    return Uint8Array.of(0xff, 0xe2, len >> 8, len & 0xff, ...head, seq, 2, ...data)
  }
  const parts = [Uint8Array.of(0xff, 0xd8), seg(2, icc.subarray(half)), seg(1, icc.subarray(0, half)), Uint8Array.of(0xff, 0xd9)]
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out.buffer
}

const P3: [XY, XY, XY] = [
  [0.68, 0.32],
  [0.265, 0.69],
  [0.15, 0.06],
]
const R709: [XY, XY, XY] = [
  [0.64, 0.33],
  [0.3, 0.6],
  [0.15, 0.06],
]

describe('perfiles ICC de la referencia', () => {
  it('extrae el perfil de un JPEG aunque venga partido y desordenado', () => {
    const icc = makeIcc(P3, 'Display P3')
    expect(Array.from(extractICC(jpegWith(icc))!)).toEqual(Array.from(icc))
    expect(parseICC(icc).description).toBe('Display P3')
  })

  it('Display P3 -> Rec.709: los primarios caen donde dice la matriz P3 -> 709', () => {
    const conv = displayConversion(makeIcc(P3, 'Display P3'))
    expect(conv.warnings).toEqual([])
    const lin = (c: number[]) => conv.convert(c, [0, 0, 0]).map(decode24)
    // matriz P3 D65 -> Rec.709 lineal (columnas = primarios de P3 en 709)
    const want = [
      [1.2249, -0.042, -0.0197],
      [-0.2247, 1.0419, -0.0786],
      [0, 0, 1.0979],
    ]
    ;[
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ].forEach((c, i) => lin(c).forEach((v, k) => expect(v).toBeCloseTo(want[i][k], 3)))
    lin([1, 1, 1]).forEach((v) => expect(v).toBeCloseTo(1, 3))
  })

  it('un perfil sRGB da lo mismo que asumir sRGB; sin perfil se avisa', () => {
    const withProfile = displayConversion(makeIcc(R709, 'sRGB IEC61966-2.1'))
    const assumed = displayConversion(null)
    expect(assumed.warnings[0]).toMatch(/no trae perfil/)
    expect(assumed.profile).toMatch(/sRGB/)
    for (const v of [0, 0.02, 0.1, 0.5, 0.8, 1]) {
      const a = withProfile.convert([v, v * 0.7, 1 - v], [0, 0, 0])
      const b = assumed.convert([v, v * 0.7, 1 - v], [0, 0, 0])
      // en lineal: el redondeo s15Fixed16 del formato deja términos cruzados de ~1e-5
      for (let k = 0; k < 3; k++) expect(decode24(a[k])).toBeCloseTo(decode24(b[k]), 4)
    }
  })

  it('un perfil que no es RGB de matriz se rechaza con aviso y se asume sRGB', () => {
    const icc = makeIcc(P3, 'x')
    icc.set(Uint8Array.from('GRAY', (c) => c.charCodeAt(0)), 16)
    const conv = displayConversion(icc)
    expect(conv.warnings[0]).toMatch(/no se puede usar/)
    expect(conv.profile).toMatch(/asumido/)
  })
})
