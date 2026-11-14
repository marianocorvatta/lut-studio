import { useEffect, useRef, useState } from 'react'
import { REC709_VECTORS } from '../color/vectors'
import type { Renderer } from '../gpu/renderer'
import { WAVE_MAX, WAVE_MIN, type ScopeImage, type ScopeMode } from '../gpu/scopes'
import { useApp } from './store'
import { viewerApi } from './Viewer'

const MODES: { id: ScopeMode; label: string }[] = [
  { id: 'waveform', label: 'Waveform' },
  { id: 'parade', label: 'Parade RGB' },
  { id: 'vectorscope', label: 'Vectorscopio' },
  { id: 'histogram', label: 'Histograma' },
]

const MIN_INTERVAL_MS = 70

/** Densidad -> nivel de gris (curva exponencial, para ver tanto las zonas densas como las ralas). */
function shade(d: number, ref: number): number {
  return d <= 0 ? 0 : Math.round(30 + 225 * (1 - Math.exp(-d / ref)))
}

function drawDensity(ctx: CanvasRenderingContext2D, s: ScopeImage, sumChannels: boolean) {
  const { width: W, height: H, data } = s
  const img = ctx.createImageData(W, H)
  const ref = Math.max(1, (s.samples / (W * H)) * 6)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const d = sumChannels ? data[i] + data[i + 1] + data[i + 2] : data[i]
      const v = shade(d, ref)
      const o = ((H - 1 - y) * W + x) * 4
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v
      img.data[o + 3] = 255
    }
  ctx.putImageData(img, 0, 0)
}

function waveGrid(ctx: CanvasRenderingContext2D, W: number, H: number, thirds: boolean) {
  ctx.strokeStyle = 'rgba(150,150,150,0.35)'
  ctx.fillStyle = 'rgba(170,170,170,0.8)'
  ctx.font = '9px system-ui, sans-serif'
  ctx.lineWidth = 1
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    const y = Math.round(H - ((v - WAVE_MIN) / (WAVE_MAX - WAVE_MIN)) * H) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
    ctx.fillText(String(Math.round(v * 1023)), 3, y - 2)
  }
  if (thirds) {
    for (const k of [1, 2]) {
      const x = Math.round((W * k) / 3) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
      ctx.stroke()
    }
    ;['R', 'G', 'B'].forEach((t, k) => ctx.fillText(t, (W * k) / 3 + W / 6 - 3, 11))
  }
}

function vectorGrid(ctx: CanvasRenderingContext2D, S: number) {
  const c = S / 2
  ctx.strokeStyle = 'rgba(150,150,150,0.35)'
  ctx.fillStyle = 'rgba(170,170,170,0.85)'
  ctx.font = '9px system-ui, sans-serif'
  ctx.beginPath()
  ctx.arc(c, c, c - 0.5, 0, Math.PI * 2)
  ctx.moveTo(0, c + 0.5)
  ctx.lineTo(S, c + 0.5)
  ctx.moveTo(c + 0.5, 0)
  ctx.lineTo(c + 0.5, S)
  ctx.stroke()
  // objetivos de las primarias y secundarias Rec.709 al 75 % (misma geometría que las ruedas)
  for (const v of REC709_VECTORS) {
    const x = c + v.cb * 0.75 * S
    const y = c - v.cr * 0.75 * S
    ctx.strokeRect(x - 4, y - 4, 8, 8)
    ctx.fillText(v.name, x + 6, y + 3)
  }
  // línea de tono de piel (eje I, ~123° desde +Cb)
  const a = (123 * Math.PI) / 180
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(c, c)
  ctx.lineTo(c + Math.cos(a) * c, c - Math.sin(a) * c)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawHistogram(ctx: CanvasRenderingContext2D, s: ScopeImage, W: number, H: number) {
  ctx.fillStyle = '#141414'
  ctx.fillRect(0, 0, W, H)
  let max = 1
  for (let i = 0; i < 256; i++) for (let k = 0; k < 3; k++) max = Math.max(max, s.data[i * 4 + k])
  const tints = ['rgba(205,170,170,0.9)', 'rgba(170,205,172,0.9)', 'rgba(170,178,210,0.9)']
  for (let k = 0; k < 3; k++) {
    ctx.strokeStyle = tints[k]
    ctx.beginPath()
    for (let i = 0; i < 256; i++) {
      const v = Math.sqrt(s.data[i * 4 + k] / max) // raíz: deja ver los bins chicos
      const x = (i / 255) * (W - 1) + 0.5
      const y = H - 1 - v * (H - 12)
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    }
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(150,150,150,0.3)'
  for (const v of [0.25, 0.5, 0.75]) {
    ctx.beginPath()
    ctx.moveTo(Math.round(v * W) + 0.5, 0)
    ctx.lineTo(Math.round(v * W) + 0.5, H)
    ctx.stroke()
  }
}

export function ScopesPanel() {
  const mode = useApp((s) => s.scopeMode)
  const image = useApp((s) => s.image)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [precise, setPrecise] = useState(true)

  useEffect(() => {
    if (mode === 'off') return
    let last = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = (r: Renderer) => {
      last = performance.now()
      const canvas = canvasRef.current
      if (!canvas) return
      const s = r.computeScope(mode)
      setPrecise(r.scopesPrecise)
      const ctx = canvas.getContext('2d')!
      if (!s) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        return
      }
      if (mode === 'histogram') {
        canvas.width = 512
        canvas.height = 200
        drawHistogram(ctx, s, canvas.width, canvas.height)
        return
      }
      canvas.width = s.width
      canvas.height = s.height
      drawDensity(ctx, s, mode === 'parade')
      if (mode === 'vectorscope') vectorGrid(ctx, s.width)
      else waveGrid(ctx, s.width, s.height, mode === 'parade')
    }
    const onRender = (r: Renderer) => {
      clearTimeout(timer)
      const wait = MIN_INTERVAL_MS - (performance.now() - last)
      if (wait <= 0) run(r)
      else timer = setTimeout(() => viewerApi.renderer && run(viewerApi.renderer), wait)
    }
    viewerApi.listeners.add(onRender)
    if (viewerApi.renderer) run(viewerApi.renderer)
    return () => {
      viewerApi.listeners.delete(onRender)
      clearTimeout(timer)
    }
  }, [mode, image])

  return (
    <div className={mode === 'off' ? 'scopes scopes--off' : 'scopes'}>
      <div className="scopes__bar">
        <div className="tabs-mini">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => useApp.getState().setScopeMode(m.id)}>
              {m.label}
            </button>
          ))}
          <button className={mode === 'off' ? 'on' : ''} onClick={() => useApp.getState().setScopeMode('off')}>
            Ocultar
          </button>
        </div>
        {mode !== 'off' && (
          <span className="scopes__note">
            Imagen completa · valores de salida (sin la transformación de visualización)
            {!precise && ' · acumulación en float16'}
          </span>
        )}
      </div>
      {mode !== 'off' && (
        <div className="scopes__body">
          {image ? <canvas ref={canvasRef} className={`scopes__canvas scopes__canvas--${mode}`} /> : <p className="hint">Abrí una imagen para ver los scopes.</p>}
        </div>
      )}
    </div>
  )
}
