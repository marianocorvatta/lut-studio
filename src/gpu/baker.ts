/**
 * Horneado del LUT en GPU: genera la grilla identidad NxNxN en el shader, la pasa por el
 * pipeline completo y deja el resultado en una textura RGBA32F de N*N x N (x = r + g*N, y = b),
 * que es el orden del .cube. Esa misma textura es la que usa el preview y la que se exporta.
 *
 * El shader replica operación por operación a color/pipeline.ts (referencia en CPU).
 */
import type { Lut, Lut3D } from '../color/lut'
import { CONV_LUT, type Prepared } from '../color/pipeline'
import { createTarget, createTexture, disposeTarget, drawTo, Program, readTarget, type GL, type Target } from './gl'
import { LutCache, type GpuLut } from './lutCache'
import { LUT_GLSL } from './lutGlsl'

const BAKE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform int uN;
uniform int uInterp;

uniform int uConvMode;
uniform sampler2D uConvLut;
uniform int uConvSize;
uniform int uConvKind;
uniform vec3 uConvMin;
uniform vec3 uConvMax;

uniform int uCreativeOn;
uniform sampler2D uCreativeLut;
uniform int uCreativeSize;
uniform int uCreativeKind;
uniform vec3 uCreativeMin;
uniform vec3 uCreativeMax;
uniform float uCreativeMix;

uniform int uClamp;
out vec4 o;
${LUT_GLSL}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = vec3(float(p.x % uN), float(p.x / uN), float(p.y)) / float(uN - 1);

  // 2. Conversión Apple Log 2 -> Rec.709
  if (uConvMode == ${CONV_LUT}) c = applyLut(uConvLut, uConvSize, uConvKind, uInterp, uConvMin, uConvMax, c);

  // 3. Etapa creativa: LUT creativo con intensidad
  if (uCreativeOn == 1) {
    vec3 t = applyLut(uCreativeLut, uCreativeSize, uCreativeKind, uInterp, uCreativeMin, uCreativeMax, c);
    c += (t - c) * uCreativeMix;
  }

  // 4. Salida
  if (uClamp == 1) c = clamp(c, 0.0, 1.0);
  o = vec4(c, 1.0);
}`

export class Baker {
  private g: GL
  private prog: Program
  private cache: LutCache
  private dummy: WebGLTexture
  private target: Target | null = null
  private size = 0
  private cpuCopy: Lut3D | null = null

  constructor(g: GL) {
    this.g = g
    this.prog = new Program(g.gl, BAKE_FS)
    this.cache = new LutCache(g)
    this.dummy = createTexture(g.gl, 1, 1, 'rgb32f', new Float32Array(3))
  }

  /** Hornea el pipeline. Devuelve el LUT en GPU, listo para aplicarlo a la imagen. */
  bake(p: Prepared, size: number): GpuLut {
    const { gl } = this.g
    if (!this.target || this.size !== size) {
      if (size * size > this.g.caps.maxTextureSize) throw new Error(`Tamaño de LUT ${size} no soportado por esta GPU.`)
      disposeTarget(gl, this.target)
      this.target = createTarget(gl, size * size, size)
      this.size = size
    }
    const used: Lut[] = []
    if (p.convLut) used.push(p.convLut)
    if (p.creativeLut) used.push(p.creativeLut)
    this.cache.retain(used)
    // subir texturas ANTES de enlazar unidades: createTexture cambia el binding de la unidad activa
    for (const lut of used) this.cache.get(lut)

    const prog = this.prog.use()
    prog.i('uN', size).i('uInterp', p.interp === 'trilinear' ? 0 : 1).i('uClamp', p.clamp ? 1 : 0)

    prog.i('uConvMode', p.convMode)
    this.bindLut('uConv', 0, p.convLut)

    prog.i('uCreativeOn', p.creativeLut ? 1 : 0).f('uCreativeMix', p.creativeMix)
    this.bindLut('uCreative', 1, p.creativeLut)

    drawTo(gl, this.target)
    this.cpuCopy = null
    return { tex: this.target.tex, size, kind: '3D', domainMin: [0, 0, 0], domainMax: [1, 1, 1] }
  }

  private bindLut(prefix: string, unit: number, lut: Lut | null): void {
    const prog = this.prog
    if (!lut) {
      prog.tex(`${prefix}Lut`, unit, this.dummy).i(`${prefix}Size`, 2).i(`${prefix}Kind`, 0)
      prog.v3(`${prefix}Min`, [0, 0, 0]).v3(`${prefix}Max`, [1, 1, 1])
      return
    }
    const gpu = this.cache.get(lut)
    prog.tex(`${prefix}Lut`, unit, gpu.tex).i(`${prefix}Size`, gpu.size).i(`${prefix}Kind`, gpu.kind === '3D' ? 0 : 1)
    prog.v3(`${prefix}Min`, gpu.domainMin).v3(`${prefix}Max`, gpu.domainMax)
  }

  /** Lee de la GPU el LUT horneado (float32). Es exactamente lo que se exporta al .cube. */
  read(): Lut3D {
    if (this.cpuCopy) return this.cpuCopy
    if (!this.target) throw new Error('Todavía no se horneó ningún LUT.')
    const rgba = readTarget(this.g.gl, this.target)
    const n = this.size
    const data = new Float32Array(n * n * n * 3)
    for (let i = 0, o = 0; i < rgba.length; i += 4) {
      data[o++] = rgba[i]
      data[o++] = rgba[i + 1]
      data[o++] = rgba[i + 2]
    }
    this.cpuCopy = { kind: '3D', size: n, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }
    return this.cpuCopy
  }

  dispose(): void {
    const { gl } = this.g
    disposeTarget(gl, this.target)
    gl.deleteTexture(this.dummy)
    this.cache.dispose()
    this.prog.dispose()
  }
}
