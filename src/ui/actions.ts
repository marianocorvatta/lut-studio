import { parseCube, writeCube } from '../color/cube'
import type { Lut } from '../color/lut'
import { decodeImage } from '../io/image'
import { lutHash, parseProject, serializeProject } from '../io/project'
import { CUBE_ACCEPT, decodeText, IMAGE_ACCEPT, pickFiles, PROJECT_ACCEPT, saveFile, type PickedFile } from '../io/platform'
import { useApp } from './store'
import { viewerApi } from './Viewer'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function loadImageFile(file: PickedFile): Promise<void> {
  const app = useApp.getState()
  app.setBusy(`Decodificando ${file.name}…`)
  try {
    const img = await decodeImage(file.bytes, file.name)
    app.setImage(img)
    for (const w of img.warnings) app.notify('warn', w)
  } catch (e) {
    app.notify('error', `No se pudo abrir "${file.name}": ${errText(e)}`)
  } finally {
    app.setBusy(null)
  }
}

export async function openImage(): Promise<void> {
  const [file] = await pickFiles(IMAGE_ACCEPT)
  if (file) await loadImageFile(file)
}

export function parseCubeFile(file: PickedFile): Lut | null {
  try {
    return parseCube(decodeText(file.bytes))
  } catch (e) {
    useApp.getState().notify('error', `No se pudo leer "${file.name}": ${errText(e)}`)
    return null
  }
}

export async function pickCube(): Promise<{ name: string; lut: Lut } | null> {
  const [file] = await pickFiles(CUBE_ACCEPT)
  if (!file) return null
  const lut = parseCubeFile(file)
  return lut ? { name: file.name, lut } : null
}

export async function addTestCubes(files?: PickedFile[]): Promise<void> {
  const list = files ?? (await pickFiles(CUBE_ACCEPT, true))
  for (const f of list) {
    const lut = parseCubeFile(f)
    if (lut) useApp.getState().addTestLayer(f.name, lut)
  }
}

/** Carga un .cube en el lugar de conversión o creativo del Estudio, verificando la huella si el proyecto lo pedía. */
export function setSlotLut(slot: 'conversion' | 'creative', name: string, lut: Lut): void {
  const app = useApp.getState()
  const want = app.missingLuts[slot]
  if (want && lutHash(lut) !== want.hash)
    app.notify('warn', `"${name}" no es el mismo LUT que guardó el proyecto ("${want.name}"): el look puede verse distinto.`)
  if (slot === 'conversion') app.setConversionLut({ name, lut })
  else app.setCreativeLut({ name, lut })
}

export async function pickSlotLut(slot: 'conversion' | 'creative'): Promise<void> {
  const picked = await pickCube()
  if (picked) setSlotLut(slot, picked.name, picked.lut)
}

const projectBase = () => (useApp.getState().image?.name ?? 'look').replace(/\.[^.]+$/, '')

export function saveProject(): void {
  const app = useApp.getState()
  app.commit()
  const text = serializeProject({
    params: app.params,
    lutSize: app.lutSize,
    interpolation: app.interpolation,
    conversionLut: app.conversionLut,
    creativeLut: app.creativeLut,
    embedLuts: app.embedLuts,
  })
  saveFile(`${projectBase()}.lutstudio.json`, text, 'application/json')
  app.notify('info', `Proyecto guardado${app.embedLuts ? ' con los LUTs incluidos' : ' (los LUTs se guardan como referencia)'}.`)
}

export function loadProjectText(name: string, text: string): void {
  const app = useApp.getState()
  try {
    const p = parseProject(text)
    const conv = p.conversionLut
    const crea = p.creativeLut
    app.loadState({
      params: p.params,
      lutSize: p.lutSize,
      interpolation: p.interpolation,
      conversionLut: conv?.lut ? { name: conv.ref.name, lut: conv.lut } : null,
      creativeLut: crea?.lut ? { name: crea.ref.name, lut: crea.lut } : null,
      missingLuts: { conversion: conv && !conv.lut ? conv.ref : null, creative: crea && !crea.lut ? crea.ref : null },
    })
    app.setMode('studio')
    for (const w of p.warnings) app.notify('warn', w)
    const missing = [conv && !conv.lut ? conv.ref.name : null, crea && !crea.lut ? crea.ref.name : null].filter(Boolean)
    app.notify(
      missing.length ? 'warn' : 'info',
      missing.length
        ? `Proyecto "${name}" abierto. Falta cargar: ${missing.join(', ')}.`
        : `Proyecto "${name}" abierto.`,
    )
  } catch (e) {
    app.notify('error', `No se pudo abrir el proyecto "${name}": ${errText(e)}`)
  }
}

export async function openProject(): Promise<void> {
  const [file] = await pickFiles(PROJECT_ACCEPT)
  if (file) loadProjectText(file.name, decodeText(file.bytes))
}

/** Reparte archivos soltados sobre la ventana: imágenes al viewer, .cube a la pila de prueba, .json como proyecto. */
export async function handleDroppedFiles(files: PickedFile[]): Promise<void> {
  const projects = files.filter((f) => /\.json$/i.test(f.name))
  if (projects[0]) loadProjectText(projects[0].name, decodeText(projects[0].bytes))
  const cubes = files.filter((f) => /\.cube$/i.test(f.name))
  const images = files.filter((f) => /\.(tiff?|png|jpe?g)$/i.test(f.name))
  if (images[0]) await loadImageFile(images[0])
  if (cubes.length) {
    const app = useApp.getState()
    if (app.mode === 'studio') {
      // en Estudio, el primer .cube soltado ocupa el lugar libre: conversión y después creativo
      const lut = parseCubeFile(cubes[0])
      if (lut) {
        setSlotLut(!app.conversionLut ? 'conversion' : 'creative', cubes[0].name, lut)
      }
    } else {
      app.setMode('test')
      await addTestCubes(cubes)
    }
  }
  if (!cubes.length && !images.length && !projects.length && files.length)
    useApp.getState().notify('warn', 'Archivo no reconocido. Se aceptan TIFF, PNG, JPEG, .cube y proyectos .json.')
}

/** Exporta el LUT horneado: se lee de la GPU la misma textura float que usa el preview. */
export function exportCube(): void {
  const app = useApp.getState()
  const r = viewerApi.renderer
  if (!r) return
  try {
    const lut = r.readBaked()
    const base = projectBase()
    const title = `LUT Studio - ${base}`
    const comments = [
      'Generado con LUT Studio',
      `Conversion: ${app.params.conversion.enabled ? (app.params.conversion.source === 'lut' ? (app.conversionLut?.name ?? 'sin LUT') : 'formula') : 'apagada'}`,
      `Interpolacion usada en el preview: ${app.interpolation === 'tetrahedral' ? 'tetraedrica' : 'trilineal'}`,
    ]
    saveFile(`${base}_${lut.size}.cube`, writeCube(lut, { title, comments }), 'text/plain')
    app.notify('info', `Exportado ${base}_${lut.size}.cube (${lut.size}³).`)
  } catch (e) {
    app.notify('error', `No se pudo exportar: ${errText(e)}`)
  }
}
