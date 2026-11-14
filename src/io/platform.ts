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

let exportDir: Promise<string | null> | null = null

/**
 * Carpeta de exportación configurada en el servidor (LUT_EXPORT_DIR, en Docker), o null si no hay: en ese caso
 * los archivos se descargan con el navegador. Se consulta una sola vez.
 */
export function getExportDir(): Promise<string | null> {
  exportDir ??= fetch('/export-config.json', { cache: 'no-store' })
    .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null))
    .then((c: { dir?: unknown } | null) => (typeof c?.dir === 'string' && c.dir.trim() ? c.dir : null))
    .catch(() => null)
  return exportDir
}

/**
 * Guarda el archivo en la carpeta de exportación del servidor si hay una configurada; si no, lo descarga.
 * Devuelve la carpeta donde quedó, o null si se descargó.
 */
export async function exportFile(name: string, content: string, mime = 'text/plain'): Promise<string | null> {
  const dir = await getExportDir()
  if (dir) {
    const r = await fetch(`/luts/${encodeURIComponent(name)}`, { method: 'PUT', body: content, headers: { 'Content-Type': mime } })
    if (!r.ok) throw new Error(`el servidor no pudo guardarlo en ${dir} (HTTP ${r.status})`)
    return dir
  }
  saveFile(name, content, mime)
  return null
}

export function decodeText(bytes: ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(bytes)
}

export const IMAGE_ACCEPT = '.tif,.tiff,.png,.jpg,.jpeg'
export const CUBE_ACCEPT = '.cube'
export const PROJECT_ACCEPT = '.json,application/json'
