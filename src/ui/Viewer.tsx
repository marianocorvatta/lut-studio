import { useCallback, useEffect, useRef, useState } from 'react'
import { sampleLut3D, type RGB } from '../color/lut'
import type { Prepared } from '../color/pipeline'
import { GpuUnsupportedError } from '../gpu/gl'
import { Renderer, type RenderLayer } from '../gpu/renderer'
import { useApp } from './store'

/** Renderer activo, para acciones fuera del componente (exportar, scopes). */
export const viewerApi: { renderer: Renderer | null } = { renderer: null }

export interface ViewerProps {
  /** pila de LUTs a aplicar sobre la imagen (modo Probar .cube) */
  layers?: RenderLayer[]
  /** referencia en CPU del mismo proceso, para el picker (modo Probar .cube) */
  computeOutput?: (rgb: RGB) => RGB
  /**
   * Modo Estudio: pipeline a hornear. El preview aplica a la imagen el LUT horneado,
   * que es exactamente el que se exporta.
   */
  bake?: { prepared: Prepared; size: number }
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

export function Viewer({ layers, computeOutput, bake, onRendered }: ViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const rafRef = useRef(0)
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered
  const [pick, setPick] = useState<Pick | null>(null)
  const [zoom, setZoom] = useState(1)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)

  const image = useApp((s) => s.image)
  const interpolation = useApp((s) => s.interpolation)
  const display = useApp((s) => s.display)
  const compare = useApp((s) => s.compare)
  const split = useApp((s) => s.split)
  const fitNonce = useApp((s) => s.fitNonce)
  const oneToOneNonce = useApp((s) => s.oneToOneNonce)

  const requestRender = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const r = rendererRef.current
      if (!r) return
      r.render()
      setZoom(r.view.scale / (window.devicePixelRatio || 1))
      onRenderedRef.current?.(r)
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
      if (viewerApi.renderer === r) viewerApi.renderer = null
    }
  }, [requestRender])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    try {
      r.setImage(image)
      r.resize()
      r.fit()
    } catch (e) {
      useApp.getState().notify('error', e instanceof Error ? e.message : String(e))
    }
    setPick(null)
    requestRender()
  }, [image, requestRender])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    try {
      if (bake) r.setLayers([{ lut: r.bake(bake.prepared, bake.size), opacity: 1 }])
      else r.setLayers(layers ?? [])
    } catch (e) {
      useApp.getState().notify('error', e instanceof Error ? e.message : String(e))
    }
    requestRender()
  }, [layers, bake, requestRender])

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
    const img = useApp.getState().image
    if (!r || !p || !img) return setPick(null)
    const [fx, fy] = r.screenToImage(p.x, p.y)
    const x = Math.floor(fx)
    const y = Math.floor(fy)
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return setPick(null)
    const o = (y * img.width + x) * 4
    const input: RGB = [img.data[o], img.data[o + 1], img.data[o + 2]]
    // En modo Estudio la salida es el LUT horneado (leído de la GPU) aplicado al píxel: lo mismo que hará DaVinci.
    const output = bake
      ? sampleLut3D(r.readBaked(), input, useApp.getState().interpolation)
      : computeOutput
        ? computeOutput(input)
        : input
    setPick({ x, y, input, output })
  }, [computeOutput, bake, interpolation])

  useEffect(() => updatePick(), [updatePick, image])

  // interacción: zoom con rueda, paneo con arrastre, cortina de comparación
  useEffect(() => {
    const canvas = canvasRef.current!
    let drag: null | { kind: 'pan' | 'split'; x: number; y: number } = null

    const onWheel = (e: WheelEvent) => {
      const r = rendererRef.current
      if (!r) return
      e.preventDefault()
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
      const nearSplit = st.compare === 'split' && Math.abs(x - st.split * rect.width) < 10
      drag = { kind: nearSplit ? 'split' : 'pan', x: e.clientX, y: e.clientY }
      canvas.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      const r = rendererRef.current
      if (!r) return
      const rect = canvas.getBoundingClientRect()
      pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      if (drag?.kind === 'split') {
        useApp.getState().setSplit((e.clientX - rect.left) / rect.width)
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
        canvas.style.cursor = st.compare === 'split' && Math.abs(pointerRef.current.x - st.split * rect.width) < 10 ? 'ew-resize' : 'crosshair'
      }
      updatePick()
    }
    const onUp = (e: PointerEvent) => {
      drag = null
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    }
    const onLeave = () => {
      if (drag) return
      pointerRef.current = null
      setPick(null)
    }
    const onDbl = () => useApp.getState().requestFit()

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
        <div className="viewer__badge">{compare === 'before' ? 'ANTES' : 'ANTES │ DESPUÉS'}</div>
      )}
      <div className="viewer__status">
        {image ? (
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
