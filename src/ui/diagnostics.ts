/**
 * Ejecuta el diagnóstico del LUT: con debounce, hornea en GPU el LUT completo sin clamp final (recorte), el look
 * solo (quiebres e inversiones) y la entrada + conversión (para ubicar los píxeles en el dominio del look), los
 * lee y los analiza en un worker. Los sliders nunca esperan al análisis.
 */
import { useEffect, useRef } from 'react'
import { DEFAULT_ANALYZE } from '../color/analyze'
import type { WorkerIn, WorkerOut } from '../color/analyze.worker'
import type { Prepared } from '../color/pipeline'
import { prepareConversion, prepareLookOnly } from '../color/variants'
import { useApp } from './store'
import { viewerApi } from './Viewer'

const DEBOUNCE_MS = 300
/** píxeles por frame que se usan para las estadísticas */
const PIXELS_PER_FRAME = 200_000

let worker: Worker | null = null
function getWorker(): Worker {
  worker ??= new Worker(new URL('../color/analyze.worker.ts', import.meta.url), { type: 'module' })
  return worker
}

/** Muestra de los valores de entrada (lo que recibe el LUT) de todos los frames. */
function samplePixels(): Float32Array {
  const frames = useApp.getState().frames
  let total = 0
  const chunks: Float32Array[] = []
  for (const f of frames) {
    const { width: w, height: h, data } = f.image
    const step = Math.max(1, Math.ceil(Math.sqrt((w * h) / PIXELS_PER_FRAME)))
    const out = new Float32Array(Math.ceil(w / step) * Math.ceil(h / step) * 3)
    let k = 0
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const o = (y * w + x) * 4
        out[k++] = data[o]
        out[k++] = data[o + 1]
        out[k++] = data[o + 2]
      }
    chunks.push(out.subarray(0, k))
    total += k
  }
  const all = new Float32Array(total)
  let o = 0
  for (const c of chunks) {
    all.set(c, o)
    o += c.length
  }
  return all
}

export function useDiagnostics(prepared: Prepared, size: number, active: boolean): void {
  const breakK = useApp((s) => s.alerts.breakK)
  const inversionTol = useApp((s) => s.alerts.inversionTol)
  const frames = useApp((s) => s.frames)
  const seq = useRef(0)

  // muestra de píxeles: una vez por cambio de frames
  useEffect(() => {
    if (!active) return
    const pixels = samplePixels()
    getWorker().postMessage({ type: 'pixels', pixels } satisfies WorkerIn, [pixels.buffer])
  }, [frames, active])

  useEffect(() => {
    const w = getWorker()
    const onMessage = (e: MessageEvent<WorkerOut>) => {
      if (e.data.id !== seq.current) return // llegó tarde: hay un análisis más nuevo
      const st = useApp.getState()
      st.setDiagnostics(e.data)
      st.setDiagBusy(false)
      viewerApi.requestRender?.()
    }
    w.addEventListener('message', onMessage)
    return () => w.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => {
      const r = viewerApi.renderer
      if (!r) return
      try {
        const st = useApp.getState()
        const luts = { conversionLut: st.conversionLut?.lut ?? null, creativeLut: st.creativeLut?.lut ?? null }
        r.bakeAux('look-analysis', prepareLookOnly(st.params, luts, st.interpolation, false), size)
        const lookLut = r.readAux('look-analysis')
        const pre = prepareConversion(st.params, luts, st.interpolation, true)
        r.setMaskSource(pre ? r.bakeAux('pre', pre, size) : null)
        const preLut = pre ? r.readAux('pre') : null
        r.setClipLut(r.bakeUnclamped(prepared, size))
        const full = r.readUnclamped()
        const id = ++seq.current
        st.setDiagBusy(true)
        getWorker().postMessage({
          type: 'analyze',
          id,
          full,
          look: lookLut,
          pre: preLut,
          opts: { breakK, breakFloor: DEFAULT_ANALYZE.breakFloor, inversionTol },
          interp: st.interpolation,
        } satisfies WorkerIn)
        viewerApi.requestRender?.()
      } catch (e) {
        useApp.getState().notify('error', `Diagnóstico: ${e instanceof Error ? e.message : String(e)}`)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [prepared, size, active, breakK, inversionTol])
}
