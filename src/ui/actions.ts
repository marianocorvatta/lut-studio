import { parseCube } from '../color/cube'
import type { Lut } from '../color/lut'
import { decodeImage } from '../io/image'
import { CUBE_ACCEPT, decodeText, IMAGE_ACCEPT, pickFiles, type PickedFile } from '../io/platform'
import { useApp } from './store'

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

/** Reparte archivos soltados sobre la ventana: imágenes al viewer, .cube a la pila de prueba. */
export async function handleDroppedFiles(files: PickedFile[]): Promise<void> {
  const cubes = files.filter((f) => /\.cube$/i.test(f.name))
  const images = files.filter((f) => /\.(tiff?|png|jpe?g)$/i.test(f.name))
  if (images[0]) await loadImageFile(images[0])
  if (cubes.length) {
    useApp.getState().setMode('test')
    await addTestCubes(cubes)
  }
  if (!cubes.length && !images.length && files.length)
    useApp.getState().notify('warn', 'Archivo no reconocido. Se aceptan TIFF, PNG, JPEG y .cube.')
}
