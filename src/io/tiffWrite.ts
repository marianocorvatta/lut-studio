/**
 * Escritor mínimo de TIFF RGB de 16 bits sin compresión (little-endian, sin perfil ICC).
 * Se usa para el chart de validación contra DaVinci.
 */

/** `rgb16`: width*height*3 muestras, fila 0 arriba. */
export function writeTiff16(width: number, height: number, rgb16: Uint16Array): Uint8Array {
  if (rgb16.length !== width * height * 3) throw new Error('writeTiff16: tamaño de datos incorrecto')
  const entries = 10
  const ifdOffset = 8
  const ifdSize = 2 + entries * 12 + 4
  const bitsOffset = ifdOffset + ifdSize
  const dataOffset = bitsOffset + 6
  const dataBytes = rgb16.length * 2
  const out = new Uint8Array(dataOffset + dataBytes)
  const dv = new DataView(out.buffer)
  dv.setUint16(0, 0x4949, false) // "II"
  dv.setUint16(2, 42, true)
  dv.setUint32(4, ifdOffset, true)
  dv.setUint16(ifdOffset, entries, true)
  let p = ifdOffset + 2
  const entry = (tag: number, type: number, count: number, value: number) => {
    dv.setUint16(p, tag, true)
    dv.setUint16(p + 2, type, true)
    dv.setUint32(p + 4, count, true)
    if (type === 3 && count === 1) dv.setUint16(p + 8, value, true)
    else dv.setUint32(p + 8, value, true)
    p += 12
  }
  const SHORT = 3
  const LONG = 4
  entry(256, LONG, 1, width) // ImageWidth
  entry(257, LONG, 1, height) // ImageLength
  entry(258, SHORT, 3, bitsOffset) // BitsPerSample -> 16,16,16
  entry(259, SHORT, 1, 1) // Compression: none
  entry(262, SHORT, 1, 2) // Photometric: RGB
  entry(273, LONG, 1, dataOffset) // StripOffsets
  entry(277, SHORT, 1, 3) // SamplesPerPixel
  entry(278, LONG, 1, height) // RowsPerStrip
  entry(279, LONG, 1, dataBytes) // StripByteCounts
  entry(284, SHORT, 1, 1) // PlanarConfiguration: chunky
  dv.setUint32(p, 0, true)
  dv.setUint16(bitsOffset, 16, true)
  dv.setUint16(bitsOffset + 2, 16, true)
  dv.setUint16(bitsOffset + 4, 16, true)
  new Uint8Array(out.buffer, dataOffset, dataBytes).set(new Uint8Array(rgb16.buffer, rgb16.byteOffset, dataBytes))
  return out
}

/** Cuantiza float 0..1 a 16 bits con redondeo al más cercano. */
export function floatToU16(v: number): number {
  const x = Math.round(v * 65535)
  return x < 0 ? 0 : x > 65535 ? 65535 : x
}
