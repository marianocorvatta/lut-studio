import type { Lut } from '../color/lut'
import { createTexture, type GL } from './gl'

export interface GpuLut {
  tex: WebGLTexture
  size: number
  kind: '3D' | '1D'
  domainMin: ArrayLike<number>
  domainMax: ArrayLike<number>
}

export function uploadLut(g: GL, lut: Lut): GpuLut {
  const { gl, caps } = g
  const n = lut.size
  const w = lut.kind === '3D' ? n * n : n
  const h = lut.kind === '3D' ? n : 1
  if (w > caps.maxTextureSize)
    throw new Error(`El LUT (${lut.kind}, tamaño ${n}) excede el tamaño máximo de textura de esta GPU (${caps.maxTextureSize}).`)
  const tex = createTexture(gl, w, h, 'rgb32f', lut.data)
  return { tex, size: n, kind: lut.kind, domainMin: lut.domainMin, domainMax: lut.domainMax }
}

/** Texturas de LUTs indexadas por el objeto Lut. `retain` libera las que ya no se usan. */
export class LutCache {
  private map = new Map<Lut, GpuLut>()
  private g: GL

  constructor(g: GL) {
    this.g = g
  }

  get(lut: Lut): GpuLut {
    let gpu = this.map.get(lut)
    if (!gpu) {
      gpu = uploadLut(this.g, lut)
      this.map.set(lut, gpu)
    }
    return gpu
  }

  /** Conserva solo las texturas de los LUTs indicados. */
  retain(used: Iterable<Lut>): void {
    const keep = new Set(used)
    for (const [lut, gpu] of this.map)
      if (!keep.has(lut)) {
        this.g.gl.deleteTexture(gpu.tex)
        this.map.delete(lut)
      }
  }

  dispose(): void {
    this.retain([])
  }
}
