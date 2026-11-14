/** Nombre de archivo y TITLE según el tipo de LUT exportado. */
export function exportNames(base: string, kind: 'full' | 'look', size: number, conversion = true): { file: string; title: string } {
  const tag = kind === 'look' ? 'look-only_Rec709' : conversion ? 'full_AppleLog2-to-Rec709' : 'full'
  return { file: `${base}_${tag}_${size}.cube`, title: `${base}_${tag}` }
}
