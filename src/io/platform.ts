/**
 * Única capa que toca APIs de archivos del navegador. Para envolver la app con Tauri
 * alcanza con reemplazar estas funciones por los diálogos y el fs de Tauri.
 */

export interface PickedFile {
  name: string
  bytes: ArrayBuffer
}

export function pickFiles(accept: string, multiple = false): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = async () => {
      const files = Array.from(input.files ?? [])
      resolve(await Promise.all(files.map(readFile)))
    }
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

export async function readFile(file: File): Promise<PickedFile> {
  return { name: file.name, bytes: await file.arrayBuffer() }
}

export function saveFile(name: string, content: string | ArrayBuffer | Uint8Array, mime = 'application/octet-stream'): void {
  const blob = new Blob([content as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function decodeText(bytes: ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(bytes)
}

export const IMAGE_ACCEPT = '.tif,.tiff,.png,.jpg,.jpeg'
export const CUBE_ACCEPT = '.cube'
