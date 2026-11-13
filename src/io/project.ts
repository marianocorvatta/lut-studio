/**
 * Proyecto guardado como JSON: todos los parámetros del look + referencias a los LUTs usados.
 * Opcionalmente, los LUTs se incrustan como texto .cube para que el proyecto sea autocontenido.
 * Lógica pura (sin APIs de navegador).
 */
import { parseCube, writeCube } from '../color/cube'
import type { Interpolation, Lut } from '../color/lut'
import { normalizeParams, type LookParams, type LutSize } from '../color/params'

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

export interface ProjectFile {
  format: typeof PROJECT_FORMAT
  version: number
  savedAt: string
  params: LookParams
  lutSize: LutSize
  interpolation: Interpolation
  conversionLut: LutRef | null
  creativeLut: LutRef | null
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
  warnings: string[]
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
    warnings,
  }
}
