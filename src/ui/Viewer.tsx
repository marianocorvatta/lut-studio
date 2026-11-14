import { useCallback, useEffect, useRef, useState } from 'react'
import { sampleLut3D, type RGB } from '../color/lut'
import type { Prepared } from '../color/pipeline'
import type { FloatImage } from '../io/image'
import { GpuUnsupportedError } from '../gpu/gl'
import { Renderer, type Rect, type RenderLayer } from '../gpu/renderer'
import { pickQualifierColor } from './qualActions'
import { useApp } from './store'

/** Renderer activo, para acciones fuera del componente (exportar, scopes, diagnóstico). */
export const viewerApi: {
  renderer: Renderer | null
  listeners: Set<(r: Renderer) => void>
  requestRender: (() => void) | null
} = {
  renderer: null,
  listeners: new Set(),
  requestRender: null,
}

export interface ViewerProps {
  /** pila de LUTs a aplicar sobre la imagen (modo Probar .cube) */
  layers?: RenderLayer[]
  /** referencia en CPU del mismo proceso, para el picker (modo Probar .cube) */
  computeOutput?: (rgb: RGB) => RGB
  /**
   * Modo Estudio: pipeline a hornear. El preview aplica a la imagen el LUT horneado,
   * que es exactamente el que se exporta.
   */
  bake?: {
    prepared: Prepared
    size: number
    /** preview "como lo vería con solo el look": la conversión y después el LUT del look, en cadena */
    lookOnly?: { conv: Prepared | null; look: Prepared } | null
    /** vista de máscara de una corrección por color: el pipeline devuelve el peso en gris (solo pantalla) */
    qualMask?: { prepared: Prepared; name: string } | null
  }
  /** imagen a mostrar en lugar de los frames del estado (pantalla de validación); sin grilla */
  image?: FloatImage | null
  /** se llama después de cada render (para scopes) */
  onRendered?: (r: Renderer) => void
}

interface Pick {
  x: number
  y: number
  input: RGB
  output: RGB
}

const fmt = (v: number) => (Object.is(v, -0) ? 0 : v).toFixed(4)
const code10 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1023)

export function Viewer({ layers, computeOutput, bake, onRendered, image: imageOverride }: ViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const rafRef = useRef(0)
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered
  const [pick, setPick] = useState<Pick | null>(null)
  const [zoom, setZoom] = useState(1)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)

  const storeImage = useApp((s) => s.image)
  const frames = useApp((s) => s.frames)
  const activeFrame = useApp((s) => s.activeFrame)
  const gridView = useApp((s) => s.gridView)
  const override = imageOverride !== undefined
  const image = override ? imageOverride : storeImage
  const imageRef = useRef(image)
  imageRef.current = image
  // grilla: solo con los frames del estado y más de uno
  const grid = !override && gridView && frames.length > 1
  const gridRef = useRef(grid)
  gridRef.current = grid
  const [cells, setCells] = useState<Rect[]>([])
  const interpolation = useApp((s) => s.interpolation)
  const display = useApp((s) => s.display)
  const compare = useApp((s) => s.compare)
  const split = useApp((s) => s.split)
  const fitNonce = useApp((s) => s.fitNonce)
  const alerts = useApp((s) => s.alerts)
  const picking = useApp((s) => s.picking)
  const diagnostics = useApp((s) => s.diagnostics)
  const oneToOneNonce = useApp((s) => s.oneToOneNonce)

  const requestRender = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const r = rendererRef.current
      if (!r) return
      r.render()
      setZoom(r.view.scale / (window.devicePixelRatio || 1))
      const next = r.grid ? r.gridCells() : []
      setCells((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
      onRenderedRef.current?.(r)
      for (const l of viewerApi.listeners) l(r)
    })
  }, [])

  // creación del renderer
  useEffect(() => {
    const canvas = canvasRef.current!
    let r: Renderer
    try {
      r = new Renderer(canvas)
    } catch (e) {
      useApp
        .getState()
        .setGpuError(e instanceof GpuUnsupportedError ? e.message : `No se pudo iniciar WebGL2: ${e instanceof Error ? e.message : e}`)
      return
    }
    rendererRef.current = r
    viewerApi.renderer = r
    viewerApi.requestRender = requestRender
    const ro = new ResizeObserver(() => requestRender())
    ro.observe(canvas)
    const onLost = (ev: Event) => {
      ev.preventDefault()
      useApp.getState().setGpuError('Se perdió el contexto de la GPU. Recargá la página.')
    }
    canvas.addEventListener('webglcontextlost', onLost)
    return () => {
      ro.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      r.dispose()
      rendererRef.current = null
      if (viewerApi.renderer === r) {
        viewerApi.renderer = null
        viewerApi.requestRender = null
      }
    }
  }, [requestRender])

  // frames: los ya cargados conservan su versión reducida en GPU; solo el principal va a resolución completa
  const fittedRef = useRef<FloatImage | null>(null)
  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    try {
      if (override) r.setImage(image)
      else
        r.setFrames(
          frames.map((f) => f.image),
          frames.findIndex((f) => f.id === activeFrame),
        )
      r.resize()
      if (image !== fittedRef.current) r.fit()
      fittedRef.current = image
    } catch (e) {
      useApp.getState().notify('error', e instanceof Error ? e.message : String(e))
    }
    setPick(null)
    requestRender()
  }, [override, image, frames, activeFrame, requestRender])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    r.grid = grid
    setPick(null)
    requestRender()
  }, [grid, requestRender])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    try {
      if (bake) {
        const full = r.bake(bake.prepared, bake.size)
        const lo = bake.lookOnly
        if (bake.qualMask) r.setLayers([{ lut: r.bakeAux('qual-mask', bake.qualMask.prepared, bake.size), opacity: 1 }])
        else if (lo) {
          const chain = [lo.conv ? r.bakeAux('conv', lo.conv, bake.size) : null, r.bakeAux('look', lo.look, bake.size)]
          r.setLayers(chain.filter((l) => l !== null).map((lut) => ({ lut, opacity: 1 })))
        } else r.setLayers([{ lut: full, opacity: 1 }])
        // overlay de recorte en vivo: el mismo pipeline sin el clamp final (no se exporta)
        if (useApp.getState().alerts.clip) r.setClipLut(r.bakeUnclamped(bake.prepared, bake.size))
      } else {
        r.setLayers(layers ?? [])
        r.setClipLut(null)
      }
    } catch (e) {
      useApp.getState().notify('error', e instanceof Error ? e.message : String(e))
    }
    requestRender()
  }, [layers, bake, requestRender])

  // overlays de alertas (solo en el Estudio): recorte, quiebres e inversiones
  const studio = Boolean(bake)
  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    r.overlay = studio
      ? { clip: alerts.clip, maskBits: (alerts.breaks ? 1 : 0) | (alerts.inversions ? 2 : 0) }
      : { clip: false, maskBits: 0 }
    if (studio && alerts.clip && bake) r.setClipLut(r.bakeUnclamped(bake.prepared, bake.size))
    const d = studio ? diagnostics : null
    r.setMask(d ? d.lookFlags : null, d?.size ?? 0)
    requestRender()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio, alerts.clip, alerts.breaks, alerts.inversions, diagnostics, requestRender])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    r.interpolation = interpolation
    r.display = display
    r.compare = compare
    r.split = split
    requestRender()
  }, [interpolation, display, compare, split, requestRender])

  useEffect(() => {
    const r = rendererRef.current
    if (!r || !fitNonce) return
    r.resize() // el visor pudo cambiar de tamaño (panel oculto, imagen a toda la ventana)
    r.fit()
    requestRender()
  }, [fitNonce, requestRender])

  useEffect(() => {
    const r = rendererRef.current
    if (!r || !oneToOneNonce) return
    r.view = { ...r.view, scale: window.devicePixelRatio || 1 }
    requestRender()
  }, [oneToOneNonce, requestRender])

  // picker: se recalcula cuando cambia el proceso o la posición del puntero
  const updatePick = useCallback(() => {
    const r = rendererRef.current
    const p = pointerRef.current
    const img = imageRef.current
    if (!r || !p || !img || gridRef.current) return setPick(null)
    const [fx, fy] = r.screenToImage(p.x, p.y)
    const x = Math.floor(fx)
    const y = Math.floor(fy)
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return setPick(null)
    const o = (y * img.width + x) * 4
    const input: RGB = [img.data[o], img.data[o + 1], img.data[o + 2]]
    // En modo Estudio la salida es el LUT horneado (leído de la GPU) aplicado al píxel: lo mismo que hará DaVinci.
    const interp = useApp.getState().interpolation
    const output = bake
      ? bake.qualMask
        ? sampleLut3D(r.readAux('qual-mask'), input, interp)
        : bake.lookOnly
        ? sampleLut3D(r.readAux('look'), bake.lookOnly.conv ? sampleLut3D(r.readAux('conv'), input, interp) : input, interp)
        : sampleLut3D(r.readBaked(), input, interp)
      : computeOutput
        ? computeOutput(input)
        : input
    setPick({ x, y, input, output })
  }, [computeOutput, bake, interpolation])

  useEffect(() => updatePick(), [updatePick, image])

  // interacción: zoom con rueda, paneo con arrastre, cortina de comparación
  useEffect(() => {
    const canvas = canvasRef.current!
    let drag: null | { kind: 'pan' | 'split' | 'pick' | 'color'; x: number; y: number; cell?: Rect } = null
    const cellAt = (r: Renderer, x: number, y: number) => {
      const cs = r.gridCells()
      const i = cs.findIndex((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h)
      return i < 0 ? null : { i, cell: cs[i] }
    }

    const onWheel = (e: WheelEvent) => {
      const r = rendererRef.current
      if (!r) return
      e.preventDefault()
      if (gridRef.current) return
      const rect = canvas.getBoundingClientRect()
      const [ix, iy] = r.screenToImage(e.clientX - rect.left, e.clientY - rect.top)
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018))
      const scale = Math.min(64, Math.max(0.02, r.view.scale * factor))
      const k = r.view.scale / scale
      r.view = { cx: ix + (r.view.cx - ix) * k, cy: iy + (r.view.cy - iy) * k, scale }
      requestRender()
    }
    const onDown = (e: PointerEvent) => {
      const r = rendererRef.current
      if (!r || e.button > 1) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const st = useApp.getState()
      if (gridRef.current) {
        // grilla: la cortina se arrastra en cualquier celda; un clic elige el frame principal
        const hit = cellAt(r, x, e.clientY - rect.top)
        if (!hit) return
        const nearSplit = st.compare === 'split' && Math.abs(x - (hit.cell.x + st.split * hit.cell.w)) < 10
        drag = { kind: nearSplit ? 'split' : 'pick', x: e.clientX, y: e.clientY, cell: hit.cell }
        canvas.setPointerCapture(e.pointerId)
        return
      }
      const nearSplit = st.compare === 'split' && Math.abs(x - st.split * rect.width) < 10
      // gotero activo: un clic toma el color (arrastrar sigue moviendo la imagen)
      drag = { kind: nearSplit ? 'split' : st.picking !== null ? 'color' : 'pan', x: e.clientX, y: e.clientY }
      canvas.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      const r = rendererRef.current
      if (!r) return
      const rect = canvas.getBoundingClientRect()
      pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      if (drag?.kind === 'split') {
        const c = drag.cell ?? { x: 0, w: rect.width }
        useApp.getState().setSplit((e.clientX - rect.left - c.x) / c.w)
      } else if (drag?.kind === 'pick') {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag = null
      } else if (drag?.kind === 'color' && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) {
        drag = { ...drag, kind: 'pan' }
      } else if (drag) {
        const dpr = canvas.width / Math.max(1, rect.width)
        r.view = {
          ...r.view,
          cx: r.view.cx - ((e.clientX - drag.x) * dpr) / r.view.scale,
          cy: r.view.cy - ((e.clientY - drag.y) * dpr) / r.view.scale,
        }
        drag = { ...drag, x: e.clientX, y: e.clientY }
        requestRender()
      } else {
        const st = useApp.getState()
        const px = pointerRef.current.x
        if (st.picking !== null && !gridRef.current) canvas.style.cursor = 'cell'
        else if (gridRef.current) {
          const hit = cellAt(r, px, pointerRef.current.y)
          canvas.style.cursor = !hit
            ? 'default'
            : st.compare === 'split' && Math.abs(px - (hit.cell.x + st.split * hit.cell.w)) < 10
              ? 'ew-resize'
              : 'pointer'
        } else canvas.style.cursor = st.compare === 'split' && Math.abs(px - st.split * rect.width) < 10 ? 'ew-resize' : 'crosshair'
      }
      updatePick()
    }
    const onUp = (e: PointerEvent) => {
      const r = rendererRef.current
      if (drag?.kind === 'pick' && r) {
        const rect = canvas.getBoundingClientRect()
        const hit = cellAt(r, e.clientX - rect.left, e.clientY - rect.top)
        const st = useApp.getState()
        const f = hit && st.frames[hit.i]
        if (f) st.setActiveFrame(f.id)
      }
      if (drag?.kind === 'color' && r) {
        const rect = canvas.getBoundingClientRect()
        const [ix, iy] = r.screenToImage(e.clientX - rect.left, e.clientY - rect.top)
        const st = useApp.getState()
        if (st.picking !== null) pickQualifierColor(st.picking, Math.floor(ix), Math.floor(iy))
      }
      drag = null
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    }
    const onLeave = () => {
      if (drag) return
      pointerRef.current = null
      setPick(null)
    }
    // doble clic: en la grilla abre el frame en grande; en la vista simple ajusta a la ventana
    const onDbl = () => {
      const st = useApp.getState()
      if (gridRef.current) st.setGridView(false)
      else st.requestFit()
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('dblclick', onDbl)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('dblclick', onDbl)
    }
  }, [requestRender, updatePick])

  return (
    <div className="viewer">
      <canvas ref={canvasRef} className="viewer__canvas" />
      {!image && (
        <div className="viewer__empty">
          <p className="viewer__empty-title">Soltá una imagen acá</p>
          <p>TIFF de 16 bits recomendado (Grab Still → Export desde DaVinci). También PNG de 16 bits.</p>
          <p>Los .cube también se pueden soltar sobre la ventana.</p>
        </div>
      )}
      {compare !== 'off' && image && (
        <div className={grid ? 'viewer__badge viewer__badge--grid' : 'viewer__badge'}>
          {compare === 'before' ? 'ANTES' : 'ANTES │ DESPUÉS'}
        </div>
      )}
      {bake?.lookOnly && image && !bake.qualMask && <div className="viewer__badge viewer__badge--low">PREVIEW: CONVERSIÓN + SOLO LOOK</div>}
      {bake?.qualMask && image && <div className="viewer__badge viewer__badge--low">MÁSCARA: {bake.qualMask.name.toUpperCase()}</div>}
      {picking !== null && image && !grid && <div className="viewer__badge viewer__badge--pick">GOTERO: CLIC SOBRE LA IMAGEN · ESC CANCELA</div>}
      {grid &&
        cells.map((c, i) => {
          const f = frames[i]
          if (!f) return null
          return (
            <div
              key={f.id}
              className={f.id === activeFrame ? 'viewer__cell viewer__cell--active' : 'viewer__cell'}
              style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
            >
              <span className="viewer__cell-label">
                {i + 1}. {f.label || f.image.name}
              </span>
            </div>
          )
        })}
      <div className="viewer__status">
        {grid ? (
          <>
            <span>
              Grilla · {frames.length} frames · mismo LUT, versiones reducidas
            </span>
            <span className="viewer__pick viewer__pick--idle">Clic: elegir principal · Doble clic: abrirlo en grande (G)</span>
          </>
        ) : image ? (
          <>
            <span>
              {image.name} · {image.width}×{image.height} · {image.format} {image.bitDepth} bits
            </span>
            <span>{Math.round(zoom * 100)}%</span>
            {pick ? (
              <span className="viewer__pick">
                x {pick.x} y {pick.y}
                <b>Entrada</b> {fmt(pick.input[0])} {fmt(pick.input[1])} {fmt(pick.input[2])}
                <i>
                  ({code10(pick.input[0])} {code10(pick.input[1])} {code10(pick.input[2])})
                </i>
                <b>Salida</b> {fmt(pick.output[0])} {fmt(pick.output[1])} {fmt(pick.output[2])}
                <i>
                  ({code10(pick.output[0])} {code10(pick.output[1])} {code10(pick.output[2])})
                </i>
              </span>
            ) : (
              <span className="viewer__pick viewer__pick--idle">Pasá el cursor sobre la imagen para ver valores (float y código de 10 bits)</span>
            )}
          </>
        ) : (
          <span>Sin imagen</span>
        )}
      </div>
    </div>
  )
}
