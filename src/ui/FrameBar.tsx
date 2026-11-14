import { openImage } from './actions'
import { MAX_FRAMES, useApp } from './store'

/**
 * Frames cargados: el principal se edita en grande; todos ven el mismo LUT. Etiqueta editable por frame.
 */
export function FrameBar() {
  const frames = useApp((s) => s.frames)
  const active = useApp((s) => s.activeFrame)
  const grid = useApp((s) => s.gridView)
  const missing = useApp((s) => s.missingFrames)
  const st = useApp.getState()
  if (!frames.length && !missing.length) return null

  return (
    <div className="frames">
      <div className="frames__list">
        {frames.map((f, i) => (
          <div key={f.id} className={f.id === active ? 'frame frame--active' : 'frame'} title={`${f.image.name} · ${f.image.width}×${f.image.height}`}>
            <button className="frame__pick" onClick={() => st.setActiveFrame(f.id)} title="Hacerlo principal">
              {i + 1}
            </button>
            <input
              className="frame__label"
              value={f.label}
              placeholder={f.image.name.replace(/\.[^.]+$/, '')}
              onChange={(e) => st.setFrameLabel(f.id, e.target.value)}
              onFocus={() => st.setActiveFrame(f.id)}
              aria-label={`Etiqueta del frame ${i + 1}`}
            />
            <button className="icon" onClick={() => st.removeFrame(f.id)} title="Quitar frame">
              ✕
            </button>
          </div>
        ))}
        <button onClick={() => void openImage()} disabled={frames.length >= MAX_FRAMES} title={`Hasta ${MAX_FRAMES} frames`}>
          + Frame
        </button>
      </div>
      <div className="seg" role="group" aria-label="Vista">
        <button className={!grid ? 'on' : ''} onClick={() => st.setGridView(false)} title="Frame principal en grande (G)">
          Principal
        </button>
        <button className={grid ? 'on' : ''} disabled={frames.length < 2} onClick={() => st.setGridView(true)} title="Todos los frames con el mismo LUT (G)">
          Grilla
        </button>
      </div>
      {missing.length > 0 && (
        <p className="frames__missing">
          Faltan frames del proyecto: {missing.map((m) => (m.label ? `${m.name} (${m.label})` : m.name)).join(', ')}. Abrilos y se
          reconocen solos.
        </p>
      )}
    </div>
  )
}
