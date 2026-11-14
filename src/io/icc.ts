/**
 * Perfiles ICC de imágenes de referencia (imágenes ya de display: JPEG, PNG, TIFF). Solo para el Match: los frames
 * de trabajo se siguen leyendo sin gestión de color.
 *
 * Soporta perfiles RGB de matriz y curvas (rXYZ/gXYZ/bXYZ + rTRC/gTRC/bTRC), que es lo que usan sRGB, Display P3,
 * Adobe RGB, etc. Los perfiles con tablas (A2B), de gris o CMYK no se soportan: se asume sRGB y se avisa.
 * Lógica pura (sin APIs de navegador).
 */
import { decode as decodePng } from 'fast-png'
import { bradford, XYZ_TO_REC709 } from '../color/appleLog'
import { encode24 } from '../color/grade'
import { mul3, mulVec3, type Mat3 } from '../color/mat3'

export interface IccProfile {
  description: string
  /** RGB lineal -> XYZ (PCS, D50) */
  toXYZ: Mat3
  /** iluminante del PCS (XYZ), normalmente D50 */
  pcsWhite: [number, number, number]
  /** curvas de tono por canal: valor de código 0..1 -> lineal */
  trc: [(v: number) => number, (v: number) => number, (v: number) => number]
}

export class IccUnsupportedError extends Error {}

const str4 = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])

// ---------------------------------------------------------------------------------------------------------------
// Extracción del perfil embebido

function tiffICC(buf: ArrayBuffer): Uint8Array | null {
  const dv = new DataView(buf)
  const le = dv.getUint16(0) === 0x4949
  const magic = dv.getUint16(2, le)
  try {
    if (magic === 42) {
      const ifd = dv.getUint32(4, le)
      const count = dv.getUint16(ifd, le)
      for (let i = 0; i < count; i++) {
        const e = ifd + 2 + i * 12
        if (dv.getUint16(e, le) !== 34675) continue
        const n = dv.getUint32(e + 4, le)
        const off = n <= 4 ? e + 8 : dv.getUint32(e + 8, le)
        return new Uint8Array(buf.slice(off, off + n))
      }
    } else if (magic === 43) {
      const ifd = Number(dv.getBigUint64(8, le))
      const count = Number(dv.getBigUint64(ifd, le))
      for (let i = 0; i < count; i++) {
        const e = ifd + 8 + i * 20
        if (dv.getUint16(e, le) !== 34675) continue
        const n = Number(dv.getBigUint64(e + 4, le))
        const off = n <= 8 ? e + 12 : Number(dv.getBigUint64(e + 12, le))
        return new Uint8Array(buf.slice(off, off + n))
      }
    }
  } catch {
    /* archivo truncado */
  }
  return null
}

function jpegICC(bytes: Uint8Array): Uint8Array | null {
  // segmentos APP2 "ICC_PROFILE\0" + número de segmento + total, en orden
  const parts: { seq: number; data: Uint8Array }[] = []
  let i = 2
  while (i + 4 < bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1]
    if (marker === 0xda || marker === 0xd9) break
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    if (marker === 0xe2 && len > 16 && str4(bytes, i + 4) === 'ICC_' && str4(bytes, i + 8) === 'PROF') {
      parts.push({ seq: bytes[i + 16], data: bytes.subarray(i + 18, i + 2 + len) })
    }
    i += 2 + len
  }
  if (!parts.length) return null
  parts.sort((a, b) => a.seq - b.seq)
  const total = parts.reduce((s, p) => s + p.data.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p.data, o)
    o += p.data.length
  }
  return out
}

/** Perfil ICC embebido en un TIFF, PNG o JPEG (null si no tiene). */
export function extractICC(buf: ArrayBuffer): Uint8Array | null {
  const b = new Uint8Array(buf)
  if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return tiffICC(buf)
  if (b[0] === 0x89 && b[1] === 0x50) return decodePng(b).iccEmbeddedProfile?.profile ?? null
  if (b[0] === 0xff && b[1] === 0xd8) return jpegICC(b)
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// Lectura del perfil

function readCurve(b: Uint8Array, dv: DataView, off: number): (v: number) => number {
  const type = str4(b, off)
  const s15 = (o: number) => dv.getInt32(o) / 65536
  if (type === 'curv') {
    const n = dv.getUint32(off + 8)
    if (n === 0) return (v) => v
    if (n === 1) {
      const g = dv.getUint16(off + 12) / 256
      return (v) => v ** g
    }
    const t = Array.from({ length: n }, (_, i) => dv.getUint16(off + 12 + i * 2) / 65535)
    return (v) => {
      const p = Math.min(1, Math.max(0, v)) * (n - 1)
      const i = Math.min(n - 2, Math.floor(p))
      return t[i] + (t[i + 1] - t[i]) * (p - i)
    }
  }
  if (type === 'para') {
    const fn = dv.getUint16(off + 8)
    const nParams = [1, 3, 4, 5, 7][fn]
    if (nParams === undefined) throw new IccUnsupportedError(`curva paramétrica de tipo ${fn}`)
    const [g, a, bb, c, d, e, f] = Array.from({ length: 7 }, (_, i) => (i < nParams ? s15(off + 12 + i * 4) : 0))
    switch (fn) {
      case 0:
        return (x) => x ** g
      case 1:
        return (x) => (x >= -bb / a ? (a * x + bb) ** g : 0)
      case 2:
        return (x) => (x >= -bb / a ? (a * x + bb) ** g + c : c)
      case 3:
        return (x) => (x >= d ? (a * x + bb) ** g : c * x)
      default:
        return (x) => (x >= d ? (a * x + bb) ** g + e : c * x + f)
    }
  }
  throw new IccUnsupportedError(`curva de tipo "${type}"`)
}

function readDescription(b: Uint8Array, dv: DataView, off: number): string {
  const type = str4(b, off)
  if (type === 'desc') {
    const n = dv.getUint32(off + 8)
    return String.fromCharCode(...b.subarray(off + 12, off + 12 + Math.max(0, n - 1)))
  }
  if (type === 'mluc') {
    const len = dv.getUint32(off + 20)
    const start = off + dv.getUint32(off + 24)
    let s = ''
    for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode(dv.getUint16(start + i))
    return s
  }
  return ''
}

export function parseICC(bytes: Uint8Array): IccProfile {
  if (bytes.length < 132) throw new IccUnsupportedError('perfil truncado')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const space = str4(bytes, 16)
  const pcs = str4(bytes, 20)
  if (space !== 'RGB ') throw new IccUnsupportedError(`espacio de color "${space.trim()}" (solo RGB)`)
  if (pcs !== 'XYZ ') throw new IccUnsupportedError(`PCS "${pcs.trim()}" (solo XYZ)`)
  const s15 = (o: number) => dv.getInt32(o) / 65536
  const tags = new Map<string, number>()
  const count = dv.getUint32(128)
  for (let i = 0; i < count; i++) tags.set(str4(bytes, 132 + i * 12), dv.getUint32(132 + i * 12 + 4))
  const xyz = (sig: string): [number, number, number] => {
    const o = tags.get(sig)
    if (o === undefined) throw new IccUnsupportedError('perfil sin matriz de colorantes (perfil de tablas)')
    return [s15(o + 8), s15(o + 12), s15(o + 16)]
  }
  const r = xyz('rXYZ')
  const g = xyz('gXYZ')
  const bl = xyz('bXYZ')
  const curve = (sig: string) => {
    const o = tags.get(sig)
    if (o === undefined) throw new IccUnsupportedError('perfil sin curvas de tono')
    return readCurve(bytes, dv, o)
  }
  const desc = tags.get('desc')
  return {
    description: desc !== undefined ? readDescription(bytes, dv, desc) : '',
    toXYZ: [r[0], g[0], bl[0], r[1], g[1], bl[1], r[2], g[2], bl[2]],
    pcsWhite: [s15(68), s15(72), s15(76)],
    trc: [curve('rTRC'), curve('gTRC'), curve('bTRC')],
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Conversión a Rec.709 γ2.4

const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const D65: [number, number] = [0.3127, 0.329]

export interface DisplayConversion {
  /** descripción del perfil usado */
  profile: string
  /** RGB de código (0..1) -> Rec.709 γ2.4 (lineal Rec.709 codificado con la gamma 2.4 del pipeline) */
  convert: (rgb: ArrayLike<number>, out: [number, number, number]) => [number, number, number]
  warnings: string[]
}

/** Conversión de una imagen de display a Rec.709 γ2.4, según su perfil (o sRGB si no tiene uno utilizable). */
export function displayConversion(icc: Uint8Array | null): DisplayConversion {
  const warnings: string[] = []
  let prof: IccProfile | null = null
  if (!icc) warnings.push('La referencia no trae perfil ICC: se asume sRGB.')
  else
    try {
      prof = parseICC(icc)
    } catch (e) {
      warnings.push(`El perfil ICC de la referencia no se puede usar (${e instanceof Error ? e.message : e}): se asume sRGB.`)
    }
  if (!prof) {
    // sRGB y Rec.709 comparten primarios y blanco: solo cambia la curva
    return {
      profile: 'sRGB (asumido)',
      convert: (c, out) => {
        for (let k = 0; k < 3; k++) out[k] = encode24(srgbDecode(Math.min(1, Math.max(0, c[k]))))
        return out
      },
      warnings,
    }
  }
  const [X, Y, Z] = prof.pcsWhite
  const pcsXY: [number, number] = [X / (X + Y + Z), Y / (X + Y + Z)]
  const M = mul3(XYZ_TO_REC709, mul3(bradford(pcsXY, D65), prof.toXYZ))
  const trc = prof.trc
  return {
    profile: prof.description || 'perfil ICC sin nombre',
    convert: (c, out) => {
      const lin = mulVec3(M, [trc[0](Math.min(1, Math.max(0, c[0]))), trc[1](Math.min(1, Math.max(0, c[1]))), trc[2](Math.min(1, Math.max(0, c[2])))])
      for (let k = 0; k < 3; k++) out[k] = encode24(lin[k])
      return out
    },
    warnings,
  }
}
