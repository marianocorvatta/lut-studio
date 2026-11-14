/** Gotero de las correcciones por color: promedia un área de la imagen en el punto del pipeline anterior a la corrección. */
import type { RGB } from '../color/lut'
import { prepare } from '../color/pipeline'
import { evalPipeline } from '../color/pipeline'
import { selectionFromSample, toLch } from '../color/qualifiers'
import { useApp } from './store'

/**
 * Toma el color en (x, y) (píxeles de imagen del frame principal), promediando un área de eyedropperSize²: cada
 * píxel pasa por el pipeline hasta justo antes de la corrección `index`. Centra la selección en ese color.
 */
export function pickQualifierColor(index: number, x: number, y: number): void {
  const st = useApp.getState()
  const img = st.image
  const q = st.params.qualifiers[index]
  if (!img || !q) return
  const p = prepare(st.params, { conversionLut: st.conversionLut?.lut ?? null, creativeLut: st.creativeLut?.lut ?? null }, st.interpolation, {
    qualifier: { index, mode: 'stop' },
  })
  const r = Math.floor(st.eyedropperSize / 2)
  const sum = [0, 0, 0]
  let n = 0
  for (let yy = y - r; yy <= y + r; yy++)
    for (let xx = x - r; xx <= x + r; xx++) {
      if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue
      const o = (yy * img.width + xx) * 4
      const c = evalPipeline(p, [img.data[o], img.data[o + 1], img.data[o + 2]] as RGB)
      sum[0] += c[0]
      sum[1] += c[1]
      sum[2] += c[2]
      n++
    }
  if (!n) return
  const avg = sum.map((v) => v / n)
  const sel = selectionFromSample(avg)
  st.updateParams((pp) => {
    const t = pp.qualifiers[index]
    if (t) Object.assign(t, sel)
  })
  st.commit()
  st.setPicking(null)
  const lch = toLch(avg)
  st.notify(
    'info',
    `Color tomado (${st.eyedropperSize}×${st.eyedropperSize} px): tono ${lch.h.toFixed(0)}°, croma ${lch.C.toFixed(3)}, luminancia ${lch.L.toFixed(2)}.`,
  )
}
