/**
 * Decodificación de imágenes a float32 SIN pasar por canvas 2D ni por la gestión de color
 * del navegador. Los valores de código se normalizan a 0..1 y los perfiles ICC se ignoran
 * (se avisa si hay uno embebido).
 */
import { fromArrayBuffer } from 'geotiff'
import { decode as decodePng } from 'fast-png'
import jpeg from 'jpeg-js'

export interface FloatImage {
  width: number
  height: number
  /** RGBA float32, fila 0 arriba, valores de código normalizados 0..1 (sin clamp si el origen es float) */
  data: Float32Array
  /** bits por canal del archivo original */
  bitDepth: number
  format: 'TIFF' | 'PNG' | 'JPEG'
  hasICC: boolean
  warnings: string[]
  name: string
}

export class ImageDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageDecodeError'
  }
}

type Numeric = ArrayLike<number>

function toRGBA(src: Numeric, width: number, height: number, channels: number, scale: number): Float32Array {
  const n = width * height
  const out = new Float32Array(n * 4)
  if (channels >= 3) {
    const hasA = channels >= 4
    for (let i = 0, s = 0, o = 0; i < n; i++, s += channels, o += 4) {
      out[o] = src[s] * scale
      out[o + 1] = src[s + 1] * scale
      out[o + 2] = src[s + 2] * scale
      out[o + 3] = hasA ? src[s + 3] * scale : 1
    }
  } else {
    const hasA = channels === 2
    for (let i = 0, s = 0, o = 0; i < n; i++, s += channels, o += 4) {
      const v = src[s] * scale
      out[o] = v
      out[o + 1] = v
      out[o + 2] = v
      out[o + 3] = hasA ? src[s + 1] * scale : 1
    }
  }
  return out
}

/** Busca el tag 34675 (ICCProfile) en el primer IFD de un TIFF clásico o BigTIFF. */
export function tiffHasICC(buf: ArrayBuffer): boolean {
  try {
    const dv = new DataView(buf)
    const le = dv.getUint16(0) === 0x4949
    const magic = dv.getUint16(2, le)
    if (magic === 42) {
      const ifd = dv.getUint32(4, le)
      const count = dv.getUint16(ifd, le)
      for (let i = 0; i < count; i++) if (dv.getUint16(ifd + 2 + i * 12, le) === 34675) return true
    } else if (magic === 43) {
      const ifd = Number(dv.getBigUint64(8, le))
      const count = Number(dv.getBigUint64(ifd, le))
      for (let i = 0; i < count; i++) if (dv.getUint16(ifd + 8 + i * 20, le) === 34675) return true
    }
  } catch {
    /* archivo truncado: sin ICC detectable */
  }
  return false
}

async function decodeTiff(buf: ArrayBuffer, name: string): Promise<FloatImage> {
  const tiff = await fromArrayBuffer(buf)
  const image = await tiff.getImage(0)
  const width = image.getWidth()
  const height = image.getHeight()
  const channels = image.getSamplesPerPixel()
  const bits = image.getBitsPerSample() as number
  const sampleFormat = image.getSampleFormat() as number // 1 uint, 2 int, 3 float
  const photometric = image.fileDirectory.getValue('PhotometricInterpretation') as number | undefined
  const warnings: string[] = []
  if (photometric !== undefined && photometric !== 2 && photometric !== 1)
    throw new ImageDecodeError(
      `TIFF con interpretación fotométrica ${photometric} no soportada. Exportá el still como RGB de 16 bits.`,
    )
  const raster = (await image.readRasters({ interleave: true })) as unknown as Numeric
  let scale = 1
  if (sampleFormat === 3) {
    warnings.push('TIFF en punto flotante: los valores se usan tal cual, sin normalizar.')
  } else if (sampleFormat === 1 || sampleFormat === undefined) {
    scale = 1 / (2 ** bits - 1)
  } else {
    throw new ImageDecodeError('TIFF con enteros con signo no soportado.')
  }
  if (bits < 16) warnings.push(`La imagen es de ${bits} bits. Para máxima fidelidad usá TIFF de 16 bits.`)
  return {
    width,
    height,
    data: toRGBA(raster, width, height, channels, scale),
    bitDepth: bits,
    format: 'TIFF',
    hasICC: tiffHasICC(buf),
    warnings,
    name,
  }
}

function decodePngImage(buf: ArrayBuffer, name: string): FloatImage {
  const png = decodePng(new Uint8Array(buf))
  const { width, height, depth, channels } = png
  const warnings: string[] = []
  let data: Float32Array
  if (png.palette) {
    const pal = png.palette
    const idx = png.data
    data = new Float32Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      const p = pal[idx[i]] ?? [0, 0, 0]
      data[i * 4] = p[0] / 255
      data[i * 4 + 1] = p[1] / 255
      data[i * 4 + 2] = p[2] / 255
      data[i * 4 + 3] = p.length > 3 ? (p[3] as number) / 255 : 1
    }
    warnings.push('PNG con paleta (8 bits). Para máxima fidelidad usá TIFF o PNG de 16 bits.')
  } else {
    data = toRGBA(png.data, width, height, channels, 1 / (2 ** depth - 1))
    if (depth < 16) warnings.push(`La imagen es de ${depth} bits. Para máxima fidelidad usá TIFF o PNG de 16 bits.`)
  }
  return {
    width,
    height,
    data,
    bitDepth: depth,
    format: 'PNG',
    hasICC: Boolean((png as { iccEmbeddedProfile?: unknown }).iccEmbeddedProfile),
    warnings,
    name,
  }
}

function jpegHasICC(bytes: Uint8Array): boolean {
  // marcador APP2 con la firma "ICC_PROFILE\0"
  const sig = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45]
  const lim = Math.min(bytes.length - sig.length, 1 << 20)
  outer: for (let i = 0; i < lim; i++) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xe2) continue
    for (let k = 0; k < sig.length; k++) if (bytes[i + 4 + k] !== sig[k]) continue outer
    return true
  }
  return false
}

function decodeJpegImage(buf: ArrayBuffer, name: string): FloatImage {
  const bytes = new Uint8Array(buf)
  const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048, maxResolutionInMP: 150 })
  return {
    width: img.width,
    height: img.height,
    data: toRGBA(img.data, img.width, img.height, 4, 1 / 255),
    bitDepth: 8,
    format: 'JPEG',
    hasICC: jpegHasICC(bytes),
    warnings: ['JPEG: 8 bits con compresión con pérdida. Sirve para probar, no para evaluar color con precisión.'],
    name,
  }
}

/** Decodifica TIFF (8/16/32 bits), PNG (8/16 bits) o JPEG a float32 RGBA. */
export async function decodeImage(buf: ArrayBuffer, name: string): Promise<FloatImage> {
  const b = new Uint8Array(buf, 0, Math.min(8, buf.byteLength))
  let img: FloatImage
  if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) img = await decodeTiff(buf, name)
  else if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) img = decodePngImage(buf, name)
  else if (b[0] === 0xff && b[1] === 0xd8) img = decodeJpegImage(buf, name)
  else throw new ImageDecodeError('Formato no reconocido. Usá TIFF de 16 bits (recomendado), PNG o JPEG.')
  if (img.hasICC)
    img.warnings.unshift(
      'La imagen trae un perfil ICC embebido. Se ignora: se usan los valores de código tal cual, igual que DaVinci sin gestión de color.',
    )
  return img
}
