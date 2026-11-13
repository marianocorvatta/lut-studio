/** Utilidades WebGL2: contexto con render a float, programas, texturas y framebuffers. */

export class GpuUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GpuUnsupportedError'
  }
}

export interface GpuCaps {
  /** filtrado lineal de texturas float (OES_texture_float_linear) */
  floatLinear: boolean
  maxTextureSize: number
}

export interface GL {
  gl: WebGL2RenderingContext
  caps: GpuCaps
  vao: WebGLVertexArrayObject
}

export function createGL(canvas: HTMLCanvasElement | OffscreenCanvas): GL {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  }) as WebGL2RenderingContext | null
  if (!gl)
    throw new GpuUnsupportedError(
      'Este navegador o esta GPU no soporta WebGL2. LUT Studio necesita WebGL2 para procesar el color en float de 32 bits.',
    )
  if (!gl.getExtension('EXT_color_buffer_float'))
    throw new GpuUnsupportedError(
      'La GPU no soporta render a texturas float (EXT_color_buffer_float). Sin eso no se puede garantizar la precisión de color, así que la app no continúa.',
    )
  const floatLinear = Boolean(gl.getExtension('OES_texture_float_linear'))
  const vao = gl.createVertexArray()!
  gl.bindVertexArray(vao)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.BLEND)
  gl.disable(gl.DITHER)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1)
  return { gl, caps: { floatLinear, maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number }, vao }
}

/** Triángulo que cubre toda la pantalla, sin buffers (usa gl_VertexID). */
export const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? ''
    gl.deleteShader(sh)
    const numbered = src
      .split('\n')
      .map((l, i) => `${String(i + 1).padStart(4)}: ${l}`)
      .join('\n')
    throw new Error(`Error al compilar shader:\n${log}\n${numbered}`)
  }
  return sh
}

export class Program {
  readonly program: WebGLProgram
  private locs = new Map<string, WebGLUniformLocation | null>()
  private gl: WebGL2RenderingContext

  constructor(gl: WebGL2RenderingContext, fs: string, vs: string = FULLSCREEN_VS) {
    this.gl = gl
    const p = gl.createProgram()!
    const v = compileShader(gl, gl.VERTEX_SHADER, vs)
    const f = compileShader(gl, gl.FRAGMENT_SHADER, fs)
    gl.attachShader(p, v)
    gl.attachShader(p, f)
    gl.linkProgram(p)
    gl.deleteShader(v)
    gl.deleteShader(f)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p)
      gl.deleteProgram(p)
      throw new Error(`Error al enlazar programa: ${log}`)
    }
    this.program = p
  }

  use(): this {
    this.gl.useProgram(this.program)
    return this
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name)
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name)
      this.locs.set(name, l)
    }
    return l
  }

  i(name: string, v: number): this {
    this.gl.uniform1i(this.loc(name), v)
    return this
  }
  f(name: string, v: number): this {
    this.gl.uniform1f(this.loc(name), v)
    return this
  }
  v2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.loc(name), x, y)
    return this
  }
  v3(name: string, v: ArrayLike<number>): this {
    this.gl.uniform3f(this.loc(name), v[0], v[1], v[2])
    return this
  }
  v4(name: string, v: ArrayLike<number>): this {
    this.gl.uniform4f(this.loc(name), v[0], v[1], v[2], v[3])
    return this
  }
  fv(name: string, v: Float32Array | number[]): this {
    this.gl.uniform1fv(this.loc(name), v)
    return this
  }
  v3v(name: string, v: Float32Array | number[]): this {
    this.gl.uniform3fv(this.loc(name), v)
    return this
  }
  m3(name: string, rowMajor: ArrayLike<number>): this {
    // se recibe en orden de filas (como se escribe en papel); GL espera columnas
    const m = rowMajor
    this.gl.uniformMatrix3fv(this.loc(name), false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]])
    return this
  }
  tex(name: string, unit: number, texture: WebGLTexture | null, target?: number): this {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(target ?? gl.TEXTURE_2D, texture)
    gl.uniform1i(this.loc(name), unit)
    return this
  }

  dispose(): void {
    this.gl.deleteProgram(this.program)
  }
}

export type TexFormat = 'rgba32f' | 'rgb32f' | 'rgba16f'

export function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  format: TexFormat,
  data: Float32Array | null,
  filter: number = gl.NEAREST,
): WebGLTexture {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  if (format === 'rgb32f') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, width, height, 0, gl.RGB, gl.FLOAT, data)
  else if (format === 'rgba16f') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, data)
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

export interface Target {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  width: number
  height: number
}

export function createTarget(gl: WebGL2RenderingContext, width: number, height: number, format: TexFormat = 'rgba32f'): Target {
  const tex = createTexture(gl, width, height, format, null)
  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new GpuUnsupportedError(`No se pudo crear un framebuffer float (${format}).`)
  return { tex, fbo, width, height }
}

export function disposeTarget(gl: WebGL2RenderingContext, t: Target | null): void {
  if (!t) return
  gl.deleteFramebuffer(t.fbo)
  gl.deleteTexture(t.tex)
}

export function drawTo(gl: WebGL2RenderingContext, target: Target | null, width?: number, height?: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null)
  gl.viewport(0, 0, target ? target.width : width!, target ? target.height : height!)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}

/** Lee una textura float RGBA completa. */
export function readTarget(gl: WebGL2RenderingContext, t: Target): Float32Array {
  const out = new Float32Array(t.width * t.height * 4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
  gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.FLOAT, out)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return out
}
