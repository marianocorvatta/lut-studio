import { useCallback, useEffect, useMemo } from 'react'
import { applyLutStack, type RGB } from '../color/lut'
import type { RenderLayer } from '../gpu/renderer'
import { readFile } from '../io/platform'
import { handleDroppedFiles, openImage } from './actions'
import { useApp, type AppMode } from './store'
import { TestPanel } from './TestPanel'
import { Viewer } from './Viewer'

const MODES: { id: AppMode; label: string; ready: boolean }[] = [
  { id: 'studio', label: 'Estudio', ready: false },
  { id: 'test', label: 'Probar .cube', ready: true },
  { id: 'validate', label: 'Validar con DaVinci', ready: false },
]

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true
  return t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)
}

export function App() {
  const mode = useApp((s) => s.mode)
  const setMode = useApp((s) => s.setMode)
  const interpolation = useApp((s) => s.interpolation)
  const display = useApp((s) => s.display)
  const compare = useApp((s) => s.compare)
  const testLayers = useApp((s) => s.testLayers)
  const notices = useApp((s) => s.notices)
  const gpuError = useApp((s) => s.gpuError)
  const busy = useApp((s) => s.busy)

  const layers: RenderLayer[] = useMemo(
    () => testLayers.filter((l) => l.enabled && l.opacity > 0).map((l) => ({ lut: l.lut, opacity: l.opacity })),
    [testLayers],
  )
  const computeOutput = useCallback(
    (rgb: RGB): RGB =>
      applyLutStack(
        layers.map((l) => ({ lut: l.lut as never, opacity: l.opacity })),
        rgb,
        interpolation,
      ),
    [layers, interpolation],
  )

  // atajos de teclado
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const st = useApp.getState()
      switch (e.key.toLowerCase()) {
        case 'b':
          if (!e.repeat) st.setCompare(st.compare === 'before' ? 'off' : 'before')
          break
        case 's':
          st.setCompare(st.compare === 'split' ? 'off' : 'split')
          break
        case 'f':
          st.requestFit()
          break
        case '1':
          st.requestOneToOne()
          break
        case 't':
          st.setInterpolation(st.interpolation === 'tetrahedral' ? 'trilinear' : 'tetrahedral')
          break
        case 'o':
          void openImage()
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  // soltar archivos sobre la ventana
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) void Promise.all(files.map(readFile)).then(handleDroppedFiles)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  if (gpuError)
    return (
      <div className="fatal">
        <h1>LUT Studio no puede iniciar</h1>
        <p>{gpuError}</p>
        <p className="hint">Probá con una versión reciente de Chrome, Edge, Safari o Firefox, con la aceleración por hardware activada.</p>
      </div>
    )

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">LUT Studio</div>
        <nav className="tabs">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={mode === m.id ? 'tab tab--on' : 'tab'}
              disabled={!m.ready}
              title={m.ready ? undefined : 'Disponible en una fase posterior'}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </nav>
        <div className="row">
          <button onClick={() => void openImage()} title="Abrir imagen (O)">
            Abrir imagen…
          </button>
          <label className="field" title="Debe coincidir con Project Settings → Color Management → 3D lookup table interpolation en DaVinci (T)">
            <span>Interpolación</span>
            <select value={interpolation} onChange={(e) => useApp.getState().setInterpolation(e.target.value as typeof interpolation)}>
              <option value="tetrahedral">Tetraédrica</option>
              <option value="trilinear">Trilineal</option>
            </select>
          </label>
          <label
            className="field"
            title="Solo afecta cómo se muestra en esta pantalla; nunca entra al .cube. Debe coincidir con la configuración del viewer de DaVinci."
          >
            <span>Visualización</span>
            <select value={display} onChange={(e) => useApp.getState().setDisplay(e.target.value as typeof display)}>
              <option value="none">Ninguna (valores directos)</option>
              <option value="rec709-srgb">Rec.709 γ2.4 → display sRGB</option>
              <option value="rec709-p3">Rec.709 γ2.4 → display P3</option>
            </select>
          </label>
          <div className="seg" role="group" aria-label="Comparación">
            <button
              className={compare === 'split' ? 'on' : ''}
              onClick={() => useApp.getState().setCompare(compare === 'split' ? 'off' : 'split')}
              title="Cortina antes/después (S)"
            >
              Cortina
            </button>
            <button
              className={compare === 'before' ? 'on' : ''}
              onClick={() => useApp.getState().setCompare(compare === 'before' ? 'off' : 'before')}
              title="Ver el original (B)"
            >
              Antes
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="stage">
          <Viewer layers={layers} computeOutput={computeOutput} />
          {busy && <div className="busy">{busy}</div>}
          <div className="notices">
            {notices.map((n) => (
              <div key={n.id} className={`notice notice--${n.kind}`}>
                <span>{n.kind === 'error' ? '✕' : n.kind === 'warn' ? '!' : 'i'}</span>
                <p>{n.text}</p>
                <button className="icon" onClick={() => useApp.getState().dismissNotice(n.id)} title="Cerrar">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
        <aside className="side">
          {mode === 'test' && <TestPanel />}
          <footer className="side__foot">
            <p>
              <b>Visualización:</b> la transformación de display solo cambia cómo se ve en este monitor. Los valores del
              picker y del .cube no la incluyen. Usá la misma que el viewer de DaVinci.
            </p>
            <p className="keys">
              <kbd>O</kbd> abrir · <kbd>S</kbd> cortina · <kbd>B</kbd> antes · <kbd>F</kbd> ajustar · <kbd>1</kbd> 100% ·{' '}
              <kbd>T</kbd> interpolación · rueda: zoom · arrastrar: mover
            </p>
          </footer>
        </aside>
      </main>
    </div>
  )
}
