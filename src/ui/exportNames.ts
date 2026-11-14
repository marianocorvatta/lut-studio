/** Limpia un nombre de archivo: sin extensión .cube, sin caracteres que los sistemas de archivos no aceptan. */
export function cleanFileName(name: string): string {
  return name
    .trim()
    .replace(/\.cube$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
}

/**
 * Nombre de archivo y TITLE del .cube. Por defecto se arma con la base y el tipo de LUT; si `custom` tiene texto,
 * se usa ese nombre tal cual (limpio) para el archivo y el TITLE.
 */
export function exportNames(
  base: string,
  kind: 'full' | 'look',
  size: number,
  conversion = true,
  custom = '',
): { file: string; title: string } {
  const name = cleanFileName(custom)
  if (name) return { file: `${name}.cube`, title: name }
  const tag = kind === 'look' ? 'look-only_Rec709' : conversion ? 'full_AppleLog2-to-Rec709' : 'full'
  return { file: `${base}_${tag}_${size}.cube`, title: `${base}_${tag}` }
}
