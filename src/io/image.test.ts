import { describe, expect, it } from 'vitest'
import { encode as encodePng } from 'fast-png'
import { decodeImage, tiffHasICC } from './image'
import { floatToU16, writeTiff16 } from './tiffWrite'

const toAB = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer

describe('decodificación de imágenes a float', () => {
  it('TIFF de 16 bits: conserva los 16 bits exactos', async () => {
    const w = 7
    const h = 5
    const src = new Uint16Array(w * h * 3)
    for (let i = 0; i < src.length; i++) src[i] = (i * 2731 + 17) & 0xffff
    src[0] = 0
    src[1] = 65535
    src[2] = 1
    const img = await decodeImage(toAB(writeTiff16(w, h, src)), 'a.tif')
    expect([img.width, img.height, img.bitDepth, img.format]).toEqual([w, h, 16, 'TIFF'])
    expect(img.hasICC).toBe(false)
    expect(img.warnings).toEqual([])
    for (let i = 0; i < w * h; i++) {
      for (let c = 0; c < 3; c++) expect(floatToU16(img.data[i * 4 + c])).toBe(src[i * 3 + c])
      expect(img.data[i * 4 + 3]).toBe(1)
    }
    expect(img.data[1]).toBe(1)
    expect(img.data[2]).toBeCloseTo(1 / 65535, 10)
  })

  it('PNG de 16 bits: conserva los 16 bits exactos', async () => {
    const w = 4
    const h = 3
    const src = new Uint16Array(w * h * 3)
    for (let i = 0; i < src.length; i++) src[i] = (i * 9973 + 255) & 0xffff
    const png = encodePng({ width: w, height: h, data: src, depth: 16, channels: 3 })
    const img = await decodeImage(toAB(png), 'a.png')
    expect([img.width, img.height, img.bitDepth, img.format]).toEqual([w, h, 16, 'PNG'])
    for (let i = 0; i < w * h; i++)
      for (let c = 0; c < 3; c++) expect(floatToU16(img.data[i * 4 + c])).toBe(src[i * 3 + c])
  })

  it('PNG de 8 bits avisa de la profundidad', async () => {
    const png = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 128, 255, 255]), depth: 8, channels: 4 })
    const img = await decodeImage(toAB(png), 'b.png')
    expect(img.bitDepth).toBe(8)
    expect(img.data[1]).toBeCloseTo(128 / 255, 7)
    expect(img.warnings.join(' ')).toMatch(/8 bits/)
  })

  it('detecta el tag ICC de un TIFF y rechaza formatos desconocidos', async () => {
    const tiff = writeTiff16(1, 1, new Uint16Array(3))
    expect(tiffHasICC(toAB(tiff))).toBe(false)
    // se cambia el tag 284 (PlanarConfiguration) por 34675 (ICCProfile) solo para probar el detector
    const dv = new DataView(tiff.buffer)
    dv.setUint16(8 + 2 + 9 * 12, 34675, true)
    expect(tiffHasICC(toAB(tiff))).toBe(true)
    await expect(decodeImage(new ArrayBuffer(16), 'x.bin')).rejects.toThrow(/Formato no reconocido/)
  })
})
