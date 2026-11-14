/**
 * Match con una imagen de referencia: carga de la referencia (con su perfil ICC) y cálculo del modelo con las
 * estadísticas de TODOS los frames cargados, después de la etapa de entrada y la conversión (donde trabaja el Match).
 */
import { computeMatchModel } from '../color/match'
import { evalPipeline } from '../color/pipeline'
import type { RGB } from '../color/lut'
import { prepareConversion } from '../color/variants'
import { displayConversion, extractICC } from '../io/icc'
import { decodeImage } from '../io/image'
import { IMAGE_ACCEPT, pickFiles, type PickedFile } from '../io/platform'
import { bytesHash } from '../io/project'
import { useApp } from './store'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** píxeles por frame y de la referencia que entran a las estadísticas */
const SAMPLES_PER_FRAME = 60_000
const REFERENCE_SAMPLES = 200_000

/** Huella de lo que determina las estadísticas de origen: si cambia, el match quedó desactualizado. */
export function matchSourceKey(): string {
  const s = useApp.getState()
  return JSON.stringify({
    frames: s.frames.map((f) => f.id),
    input: s.params.input,
    conversion: s.params.conversion,
    lut: s.conversionLut?.name ?? null,
    interp: s.interpolation,
  })
}

function sampleRGB(data: Float32Array, w: number, h: number, max: number, map: (c: RGB) => RGB): Float32Array {
  const step = Math.max(1, Math.ceil(Math.sqrt((w * h) / max)))
  const out = new Float32Array(Math.ceil(w / step) * Math.ceil(h / step) * 3)
  let k = 0
  const c: RGB = [0, 0, 0]
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const o = (y * w + x) * 4
      c[0] = data[o]
      c[1] = data[o + 1]
      c[2] = data[o + 2]
      const r = map(c)
      out[k++] = r[0]
      out[k++] = r[1]
      out[k++] = r[2]
    }
  return out.subarray(0, k)
}

/** Muestras Rec.709 γ2.4 de todos los frames: entrada + conversión (sin look), como las ve el Match. */
function sourceSamples(): Float32Array {
  const s = useApp.getState()
  const luts = { conversionLut: s.conversionLut?.lut ?? null, creativeLut: null }
  const pre = prepareConversion(s.params, luts, s.interpolation, true)
  const parts = s.frames.map((f) =>
    sampleRGB(f.image.data, f.image.width, f.image.height, SAMPLES_PER_FRAME, (c) => (pre ? evalPipeline(pre, c) : c)),
  )
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    all.set(p, o)
    o += p.length
  }
  return all
}

/** Calcula el modelo de match con la referencia y los frames actuales y lo deja en el look (punto de deshacer). */
export function computeMatch(): void {
  const app = useApp.getState()
  const ref = app.reference
  if (!ref) return app.notify('warn', 'Cargá una imagen de referencia.')
  if (!app.frames.length) return app.notify('warn', 'Cargá al menos un frame: el match usa sus estadísticas.')
  try {
    const model = computeMatchModel(sourceSamples(), ref.samples, { reference: ref.name, frames: app.frames.length })
    app.updateParams((p) => {
      p.match.model = model
      p.match.enabled = true
    })
    app.commit()
    app.setMatchKey(matchSourceKey())
  } catch (e) {
    app.notify('error', `No se pudo calcular el match: ${errText(e)}`)
  }
}

/**
 * Carga la referencia: decodifica, aplica su perfil ICC (o sRGB si no tiene, con aviso) y la pasa a Rec.709 γ2.4.
 * Si es la que pedía el proyecto abierto, no recalcula (el modelo guardado se conserva).
 */
export async function loadReferenceFile(file: PickedFile, opts: { recompute?: boolean } = {}): Promise<void> {
  const app = useApp.getState()
  app.setBusy(`Decodificando la referencia ${file.name}…`)
  try {
    const img = await decodeImage(file.bytes, file.name)
    const conv = displayConversion(extractICC(file.bytes))
    const samples = sampleRGB(img.data, img.width, img.height, REFERENCE_SAMPLES, (c) => conv.convert(c, [0, 0, 0]))
    const hash = bytesHash(new Uint8Array(file.bytes))
    const wasMissing = app.missingReference?.hash === hash
    app.setReference({ name: file.name, bytes: file.bytes, hash, width: img.width, height: img.height, profile: conv.profile, samples })
    app.setMissingReference(null)
    for (const w of conv.warnings) app.notify('warn', w)
    // el aviso de "perfil ignorado" es para los frames; acá el perfil sí se usa
    for (const w of img.warnings) if (!/perfil ICC/.test(w) && !/bits/.test(w) && !/JPEG/.test(w)) app.notify('warn', `${file.name}: ${w}`)
    if (opts.recompute ?? !wasMissing) computeMatch()
  } catch (e) {
    app.notify('error', `No se pudo abrir la referencia "${file.name}": ${errText(e)}`)
  } finally {
    app.setBusy(null)
  }
}

export async function pickReference(): Promise<void> {
  const [file] = await pickFiles(IMAGE_ACCEPT)
  if (file) await loadReferenceFile(file)
}
