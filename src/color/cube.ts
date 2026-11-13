/**
 * Lectura y escritura del formato .cube (Adobe / Resolve).
 * Matemática y texto puros: sin APIs de navegador.
 */
import type { Lut, Lut1D, Lut3D } from './lut'

export class CubeParseError extends Error {
  line?: number
  constructor(message: string, line?: number) {
    super(line ? `Línea ${line}: ${message}` : message)
    this.name = 'CubeParseError'
    this.line = line
  }
}

type Triple = [number, number, number]

function parseTriple(parts: string[], line: number, what: string): Triple {
  if (parts.length < 4) throw new CubeParseError(`${what} necesita 3 valores`, line)
  const v = [Number(parts[1]), Number(parts[2]), Number(parts[3])] as Triple
  if (v.some((x) => !Number.isFinite(x))) throw new CubeParseError(`${what} tiene valores no numéricos`, line)
  return v
}

/**
 * Parsea un .cube. Soporta TITLE, comentarios #, LUT_3D_SIZE, LUT_1D_SIZE,
 * DOMAIN_MIN, DOMAIN_MAX, LUT_3D_INPUT_RANGE / LUT_1D_INPUT_RANGE (variante Resolve),
 * líneas vacías, BOM y finales de línea Windows/Unix/Mac clásico.
 */
export function parseCube(text: string): Lut {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.split(/\r\n|\n|\r/)
  let title: string | undefined
  let size3 = 0
  let size1 = 0
  let domainMin: Triple = [0, 0, 0]
  let domainMax: Triple = [1, 1, 1]
  let data: Float32Array | null = null
  let count = 0
  let expected = 0

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (raw === '' || raw[0] === '#') continue
    const lineNo = i + 1
    const ch = raw.charCodeAt(0)
    const isNumeric = (ch >= 48 && ch <= 57) || ch === 45 || ch === 43 || ch === 46
    if (!isNumeric) {
      const parts = raw.split(/\s+/)
      const key = parts[0].toUpperCase()
      if (data && count > 0) throw new CubeParseError(`palabra clave "${parts[0]}" después de los datos`, lineNo)
      switch (key) {
        case 'TITLE': {
          const m = raw.match(/^\S+\s+"(.*)"\s*$/)
          title = m ? m[1] : raw.slice(5).trim()
          break
        }
        case 'LUT_3D_SIZE':
        case 'LUT_1D_SIZE': {
          const n = Number(parts[1])
          if (!Number.isInteger(n) || n < 2) throw new CubeParseError(`${key} inválido: "${parts[1] ?? ''}"`, lineNo)
          if (key === 'LUT_3D_SIZE') {
            if (n > 256) throw new CubeParseError(`LUT_3D_SIZE demasiado grande (${n})`, lineNo)
            size3 = n
          } else {
            if (n > 65536) throw new CubeParseError(`LUT_1D_SIZE demasiado grande (${n})`, lineNo)
            size1 = n
          }
          break
        }
        case 'DOMAIN_MIN':
          domainMin = parseTriple(parts, lineNo, 'DOMAIN_MIN')
          break
        case 'DOMAIN_MAX':
          domainMax = parseTriple(parts, lineNo, 'DOMAIN_MAX')
          break
        case 'LUT_3D_INPUT_RANGE':
        case 'LUT_1D_INPUT_RANGE': {
          const lo = Number(parts[1])
          const hi = Number(parts[2])
          if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new CubeParseError(`${key} inválido`, lineNo)
          domainMin = [lo, lo, lo]
          domainMax = [hi, hi, hi]
          break
        }
        default:
          throw new CubeParseError(`palabra clave desconocida "${parts[0]}"`, lineNo)
      }
      continue
    }

    if (!data) {
      if (size3 && size1) throw new CubeParseError('LUT 1D + 3D combinados en un mismo archivo no está soportado', lineNo)
      if (!size3 && !size1) throw new CubeParseError('faltan LUT_3D_SIZE o LUT_1D_SIZE antes de los datos', lineNo)
      expected = size3 ? size3 * size3 * size3 : size1
      data = new Float32Array(expected * 3)
    }
    if (count >= expected) throw new CubeParseError(`hay más filas de datos que las esperadas (${expected})`, lineNo)
    const parts = raw.split(/\s+/)
    if (parts.length !== 3) throw new CubeParseError(`se esperaban 3 valores y hay ${parts.length}`, lineNo)
    const r = Number(parts[0])
    const g = Number(parts[1])
    const b = Number(parts[2])
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b))
      throw new CubeParseError('valor no numérico en los datos', lineNo)
    const o = count * 3
    data[o] = r
    data[o + 1] = g
    data[o + 2] = b
    count++
  }

  if (!data) throw new CubeParseError('el archivo no contiene datos de LUT')
  if (count !== expected) throw new CubeParseError(`faltan datos: se esperaban ${expected} filas y hay ${count}`)
  for (let c = 0; c < 3; c++)
    if (!(domainMax[c] > domainMin[c])) throw new CubeParseError('DOMAIN_MAX debe ser mayor que DOMAIN_MIN')

  const base = { size: size3 || size1, data, domainMin, domainMax, title }
  return size3 ? ({ kind: '3D', ...base } satisfies Lut3D) : ({ kind: '1D', ...base } satisfies Lut1D)
}

export interface WriteCubeOptions {
  title?: string
  comments?: string[]
  /**
   * cantidad de decimales (por defecto 6, lo estándar para DaVinci), o 'exact': la representación más
   * corta que vuelve exactamente al mismo float32 (para guardar LUTs dentro de un proyecto)
   */
  precision?: number | 'exact'
}

const fmtNum = (x: number) => (Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(9))))

/** Representación decimal más corta que, leída como float32, da exactamente `x`. */
function shortestF32(x: number): string {
  const f = Math.fround(x)
  for (let p = 1; p <= 9; p++) {
    const s = f.toPrecision(p)
    if (Math.fround(Number(s)) === f) return String(Number(s))
  }
  return String(f)
}

function fix(x: number, precision: number | 'exact'): string {
  if (precision === 'exact') return Object.is(x, -0) || x === 0 ? '0' : shortestF32(x)
  const s = x.toFixed(precision)
  // evitar "-0.000000"
  return Number(s) === 0 ? (0).toFixed(precision) : s
}

/** Escribe un .cube: TITLE, LUT_xD_SIZE, DOMAIN_MIN, DOMAIN_MAX y valores con 6 decimales. */
export function writeCube(lut: Lut, opts: WriteCubeOptions = {}): string {
  const precision = opts.precision ?? 6
  const title = (opts.title ?? lut.title ?? 'LUT Studio').replace(/"/g, "'")
  const head: string[] = [`TITLE "${title}"`]
  for (const c of opts.comments ?? []) head.push(`# ${c.replace(/[\r\n]+/g, ' ')}`)
  head.push(`${lut.kind === '3D' ? 'LUT_3D_SIZE' : 'LUT_1D_SIZE'} ${lut.size}`)
  head.push(`DOMAIN_MIN ${lut.domainMin.map(fmtNum).join(' ')}`)
  head.push(`DOMAIN_MAX ${lut.domainMax.map(fmtNum).join(' ')}`)
  const d = lut.data
  const rows = d.length / 3
  const chunks: string[] = [head.join('\n'), '\n']
  let buf = ''
  for (let i = 0; i < rows; i++) {
    const o = i * 3
    buf += `${fix(d[o], precision)} ${fix(d[o + 1], precision)} ${fix(d[o + 2], precision)}\n`
    if ((i & 4095) === 4095) {
      chunks.push(buf)
      buf = ''
    }
  }
  chunks.push(buf)
  return chunks.join('')
}
