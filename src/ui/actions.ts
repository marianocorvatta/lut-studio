import { parseCube, writeCube } from '../color/cube'
import type { Lut } from '../color/lut'
import { decodeImage, type FloatImage } from '../io/image'
import { frameHash, lutHash, parseProject, serializeProject } from '../io/project'
import { CUBE_ACCEPT, decodeText, IMAGE_ACCEPT, pickFiles, PROJECT_ACCEPT, saveFile, type PickedFile } from '../io/platform'
import { MAX_FRAMES, useApp } from './store'
import { viewerApi } from './Viewer'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Agrega frames (hasta MAX_FRAMES). Si el proyecto abierto esperaba un frame con la misma huella o el mismo
 * nombre, toma su etiqueta. El primero agregado pasa a ser el principal.
 */
export async function loadImageFiles(files: PickedFile[]): Promise<void> {
  const app = useApp.getState()
  const room = MAX_FRAMES - app.frames.length
  if (room <= 0) {
    app.notify('warn', `Ya hay ${MAX_FRAMES} frames cargados (el máximo). Quitá alguno para agregar otro.`)
    return
  }
  if (files.length > room)
    app.notify('warn', `Se cargan ${room} de ${files.length} imágenes: el máximo es ${MAX_FRAMES} frames.`)
  const items: { image: FloatImage; label?: string }[] = []
  for (const file of files.slice(0, room)) {
    app.setBusy(`Decodificando ${file.name}…`)
    try {
      const image = await decodeImage(file.bytes, file.name)
      for (const w of image.warnings) app.notify('warn', `${file.name}: ${w}`)
      items.push({ image, label: claimMissingFrame(image) })
    } catch (e) {
      app.notify('error', `No se pudo abrir "${file.name}": ${errText(e)}`)
    }
  }
  app.setBusy(null)
  useApp.getState().addFrames(items)
}

/** Si el proyecto esperaba este frame, lo saca de la lista de faltantes y devuelve su etiqueta. */
function claimMissingFrame(image: FloatImage): string | undefined {
  const app = useApp.getState()
  if (!app.missingFrames.length) return undefined
  const hash = frameHash(image)
  const byHash = app.missingFrames.find((r) => r.hash === hash)
  const ref = byHash ?? app.missingFrames.find((r) => r.name === image.name)
  if (!ref) return undefined
  if (!byHash) app.notify('warn', `"${image.name}" no tiene los mismos píxeles que el frame que guardó el proyecto.`)
  app.setMissingFrames(app.missingFrames.filter((r) => r !== ref))
  return ref.label
}

export async function loadImageFile(file: PickedFile): Promise<void> {
  await loadImageFiles([file])
}

export async function openImage(): Promise<void> {
  const files = await pickFiles(IMAGE_ACCEPT, true)
  if (files.length) await loadImageFiles(files)
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
    frames: app.frames.map((f) => ({ label: f.label, image: f.image })),
    activeFrame: Math.max(0, app.frames.findIndex((f) => f.id === app.activeFrame)),
    embedFrames: app.embedFrames,
  })
  saveFile(`${projectBase()}.lutstudio.json`, text, 'application/json')
  const what = [app.embedLuts ? 'los LUTs' : null, app.embedFrames && app.frames.length ? 'los frames' : null].filter(Boolean)
  app.notify(
    'info',
    `Proyecto guardado${what.length ? ` con ${what.join(' y ')} incluidos` : ''}. ${
      what.length < 2 ? 'Lo que no se incluye queda como referencia.' : ''
    }`.trim(),
  )
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
    // frames: los incluidos se cargan; los que van por referencia quedan pendientes (se reconocen al abrirlos)
    if (p.frames.length) {
      const present = p.frames.filter((f) => f.image)
      const activeRef = p.frames[p.activeFrame]
      const active = Math.max(0, present.findIndex((f) => f === activeRef))
      app.replaceFrames(
        present.map((f) => ({ image: f.image!, label: f.ref.label })),
        active,
      )
      app.setMissingFrames(p.frames.filter((f) => !f.image).map((f) => f.ref))
    } else app.setMissingFrames([])
    for (const w of p.warnings) app.notify('warn', w)
    const missing = [
      conv && !conv.lut ? conv.ref.name : null,
      crea && !crea.lut ? crea.ref.name : null,
      ...p.frames.filter((f) => !f.image).map((f) => `${f.ref.name}${f.ref.label ? ` (${f.ref.label})` : ''}`),
    ].filter(Boolean)
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
  if (images.length) await loadImageFiles(images)
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
