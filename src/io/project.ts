/**
 * Proyecto guardado como JSON: todos los parámetros del look + referencias a los LUTs usados.
 * Opcionalmente, los LUTs se incrustan como texto .cube para que el proyecto sea autocontenido.
 * Lógica pura (sin APIs de navegador).
 */
import { parseCube, writeCube } from '../color/cube'
import type { Interpolation, Lut } from '../color/lut'
import { normalizeParams, type LookParams, type LutSize } from '../color/params'
import type { FloatImage } from './image'

export const PROJECT_FORMAT = 'lut-studio-project'
export const PROJECT_VERSION = 1

export interface LutRef {
  name: string
  kind: '3D' | '1D'
  size: number
  /** huella de los datos (FNV-1a de los float32), para verificar que se recarga el mismo LUT */
  hash: string
  /** texto .cube incrustado (opcional) */
  cube?: string
}

/** Frame del proyecto: por referencia (nombre y huella) o con los píxeles incluidos. */
export interface FrameRef {
  name: string
  label: string
  width: number
  height: number
  /** huella de los píxeles float32 (FNV-1a), para verificar que se recarga el mismo frame */
  hash: string
  /** píxeles RGB incluidos (opcional): enteros de 8 o 16 bits si la ida y vuelta es exacta, si no float32 */
  pixels?: { encoding: 'u8' | 'u16' | 'f32'; bitDepth: number; format: FloatImage['format']; base64: string }
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT
  version: number
  savedAt: string
  params: LookParams
  lutSize: LutSize
  interpolation: Interpolation
  conversionLut: LutRef | null
  creativeLut: LutRef | null
  /** frames cargados (desde la etapa de varios frames; opcional) */
  frames?: FrameRef[]
  /** índice del frame principal */
  activeFrame?: number
}

function fnv(bytes: Uint8Array, h = 0x811c9dc5): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

const asBytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength)

/** Huella de los píxeles de un frame (FNV-1a de los float32 y las dimensiones). */
export function frameHash(img: Pick<FloatImage, 'width' | 'height' | 'data'>): string {
  const h = fnv(new TextEncoder().encode(`${img.width}x${img.height}`))
  return fnv(asBytes(img.data), h).toString(16).padStart(8, '0')
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Enteros de `bits` bits si reproducen exactamente los float32 (u * (1 / max), como el decodificador). */
function tryInts(data: Float32Array, n: number, bits: 8 | 16): Uint8Array | Uint16Array | null {
  const max = 2 ** bits - 1
  const inv = 1 / max
  const out = bits === 8 ? new Uint8Array(n * 3) : new Uint16Array(n * 3)
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) {
      const v = data[i * 4 + c]
      const u = Math.round(v * max)
      if (u < 0 || u > max || (Math.fround(u * inv) !== v && Math.fround(u / max) !== v)) return null
      out[i * 3 + c] = u
    }
  return out
}

export function encodeFramePixels(img: FloatImage): NonNullable<FrameRef['pixels']> {
  const n = img.width * img.height
  const meta = { bitDepth: img.bitDepth, format: img.format }
  if (img.bitDepth <= 8) {
    const u8 = tryInts(img.data, n, 8)
    if (u8) return { encoding: 'u8', ...meta, base64: toBase64(asBytes(u8)) }
  }
  if (img.bitDepth <= 16) {
    const u16 = tryInts(img.data, n, 16)
    if (u16) return { encoding: 'u16', ...meta, base64: toBase64(asBytes(u16)) }
  }
  const f = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) f[i * 3 + c] = img.data[i * 4 + c]
  return { encoding: 'f32', ...meta, base64: toBase64(asBytes(f)) }
}

export function decodeFramePixels(ref: FrameRef): FloatImage {
  const px = ref.pixels!
  const n = ref.width * ref.height
  const bytes = fromBase64(px.base64)
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const src = px.encoding === 'u8' ? new Uint8Array(buf) : px.encoding === 'u16' ? new Uint16Array(buf) : new Float32Array(buf)
  if (src.length !== n * 3) throw new ProjectError(`Los píxeles incluidos de "${ref.name}" no tienen el tamaño esperado.`)
  const data = new Float32Array(n * 4)
  const max = px.encoding === 'u8' ? 255 : 65535
  const inv = 1 / max
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const u = src[i * 3 + c]
      data[i * 4 + c] = px.encoding === 'f32' ? u : u * inv
    }
    data[i * 4 + 3] = 1
  }
  // el decodificador de PNG/JPEG de 8 bits divide por 255 en lugar de multiplicar por 1/255: si la huella no
  // coincide, se prueba esa variante
  if (px.encoding !== 'f32' && frameHash({ width: ref.width, height: ref.height, data }) !== ref.hash)
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) data[i * 4 + c] = src[i * 3 + c] / max
  return {
    width: ref.width,
    height: ref.height,
    data,
    bitDepth: px.bitDepth,
    format: px.format,
    hasICC: false,
    warnings: [],
    name: ref.name,
  }
}

export function frameRef(label: string, img: FloatImage, embed: boolean): FrameRef {
  return {
    name: img.name,
    label,
    width: img.width,
    height: img.height,
    hash: frameHash(img),
    ...(embed ? { pixels: encodeFramePixels(img) } : {}),
  }
}

/** FNV-1a de 32 bits sobre los bytes de los datos y la cabecera del LUT. */
export function lutHash(lut: Lut): string {
  let h = 0x811c9dc5
  const mix = (byte: number) => {
    h ^= byte
    h = Math.imul(h, 0x01000193) >>> 0
  }
  for (const c of `${lut.kind}${lut.size}${lut.domainMin.join(',')}${lut.domainMax.join(',')}`) mix(c.charCodeAt(0) & 0xff)
  const bytes = new Uint8Array(lut.data.buffer, lut.data.byteOffset, lut.data.byteLength)
  for (let i = 0; i < bytes.length; i++) mix(bytes[i])
  return h.toString(16).padStart(8, '0')
}

export function lutRef(name: string, lut: Lut, embed: boolean): LutRef {
  return {
    name,
    kind: lut.kind,
    size: lut.size,
    hash: lutHash(lut),
    // el .cube incrustado es exacto para float32
    ...(embed ? { cube: writeCube(lut, { title: lut.title ?? name, precision: 'exact' }) } : {}),
  }
}

export interface ProjectInput {
  params: LookParams
  lutSize: LutSize
  interpolation: Interpolation
  conversionLut: { name: string; lut: Lut } | null
  creativeLut: { name: string; lut: Lut } | null
  embedLuts: boolean
  frames?: { label: string; image: FloatImage }[]
  activeFrame?: number
  embedFrames?: boolean
}

export function serializeProject(p: ProjectInput, now = new Date()): string {
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: now.toISOString(),
    params: p.params,
    lutSize: p.lutSize,
    interpolation: p.interpolation,
    conversionLut: p.conversionLut ? lutRef(p.conversionLut.name, p.conversionLut.lut, p.embedLuts) : null,
    creativeLut: p.creativeLut ? lutRef(p.creativeLut.name, p.creativeLut.lut, p.embedLuts) : null,
    frames: (p.frames ?? []).map((f) => frameRef(f.label, f.image, p.embedFrames ?? false)),
    activeFrame: p.activeFrame ?? 0,
  }
  return JSON.stringify(file, null, 2)
}

export class ProjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectError'
  }
}

export interface LoadedProject {
  params: LookParams
  lutSize: LutSize
  interpolation: Interpolation
  /** LUTs incrustados ya parseados (si el proyecto los traía) */
  conversionLut: { ref: LutRef; lut: Lut | null } | null
  creativeLut: { ref: LutRef; lut: Lut | null } | null
  /** frames del proyecto: con imagen si venían incluidos */
  frames: { ref: FrameRef; image: FloatImage | null }[]
  activeFrame: number
  warnings: string[]
}

function parseFrames(raw: unknown, warnings: string[]): { ref: FrameRef; image: FloatImage | null }[] {
  if (!Array.isArray(raw)) return []
  const out: { ref: FrameRef; image: FloatImage | null }[] = []
  for (const r of raw as Partial<FrameRef>[]) {
    if (!r || typeof r.name !== 'string' || typeof r.hash !== 'string') {
      warnings.push('Se ignoró un frame con la referencia incompleta.')
      continue
    }
    const ref: FrameRef = {
      name: r.name,
      label: typeof r.label === 'string' ? r.label : '',
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
      hash: r.hash,
      pixels: r.pixels,
    }
    let image: FloatImage | null = null
    if (ref.pixels) {
      try {
        image = decodeFramePixels(ref)
        if (frameHash(image) !== ref.hash) warnings.push(`El frame incluido "${ref.name}" no coincide con su huella: se usa igual.`)
      } catch (e) {
        warnings.push(`No se pudo leer el frame incluido "${ref.name}": ${e instanceof Error ? e.message : e}`)
      }
    }
    out.push({ ref, image })
  }
  return out
}

function parseRef(raw: unknown, label: string, warnings: string[]): { ref: LutRef; lut: Lut | null } | null {
  if (raw === null || raw === undefined) return null
  const r = raw as Partial<LutRef>
  if (typeof r.name !== 'string' || typeof r.hash !== 'string') throw new ProjectError(`La referencia al ${label} está incompleta.`)
  const ref: LutRef = { name: r.name, kind: r.kind === '1D' ? '1D' : '3D', size: Number(r.size) || 0, hash: r.hash, cube: r.cube }
  if (typeof r.cube !== 'string') return { ref, lut: null }
  try {
    const lut = parseCube(r.cube)
    if (lutHash(lut) !== ref.hash) warnings.push(`El ${label} incrustado ("${ref.name}") no coincide con su huella: se usa igual.`)
    return { ref, lut }
  } catch (e) {
    warnings.push(`No se pudo leer el ${label} incrustado ("${ref.name}"): ${e instanceof Error ? e.message : e}`)
    return { ref, lut: null }
  }
}

export function parseProject(text: string): LoadedProject {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ProjectError('El archivo no es un JSON válido.')
  }
  const f = raw as Partial<ProjectFile>
  if (!f || f.format !== PROJECT_FORMAT) throw new ProjectError('El archivo no es un proyecto de LUT Studio.')
  if (typeof f.version !== 'number' || f.version > PROJECT_VERSION)
    throw new ProjectError(`Versión de proyecto no soportada (${String(f.version)}). Actualizá LUT Studio.`)
  const warnings: string[] = []
  return {
    params: normalizeParams(f.params),
    lutSize: f.lutSize === 65 ? 65 : 33,
    interpolation: f.interpolation === 'trilinear' ? 'trilinear' : 'tetrahedral',
    conversionLut: parseRef(f.conversionLut, 'LUT de conversión', warnings),
    creativeLut: parseRef(f.creativeLut, 'LUT creativo', warnings),
    frames: parseFrames(f.frames, warnings),
    activeFrame: Math.max(0, Math.floor(Number(f.activeFrame) || 0)),
    warnings,
  }
}
