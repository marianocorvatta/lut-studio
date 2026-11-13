import { addTestCubes } from './actions'
import { useApp } from './store'

export function TestPanel() {
  const layers = useApp((s) => s.testLayers)
  const update = useApp((s) => s.updateTestLayer)
  const move = useApp((s) => s.moveTestLayer)
  const remove = useApp((s) => s.removeTestLayer)
  const clear = useApp((s) => s.clearTestLayers)

  return (
    <div className="panel">
      <section className="group">
        <header className="group__head">
          <h2>LUTs apilados</h2>
          <div className="row">
            <button onClick={() => void addTestCubes()}>Agregar .cube…</button>
            <button onClick={clear} disabled={!layers.length} title="Quitar todos">
              Vaciar
            </button>
          </div>
        </header>
        <p className="hint">
          Se aplican de arriba hacia abajo, como nodos en serie. Cada uno se interpola con el método elegido arriba
          (trilineal o tetraédrica).
        </p>
        {layers.length === 0 && <p className="empty">Todavía no hay LUTs. Agregá uno o soltá archivos .cube sobre la ventana.</p>}
        <ol className="layers">
          {layers.map((l, i) => (
            <li key={l.id} className={l.enabled ? 'layer' : 'layer layer--off'}>
              <div className="layer__top">
                <label className="check" title="Activar / desactivar">
                  <input type="checkbox" checked={l.enabled} onChange={(e) => update(l.id, { enabled: e.target.checked })} />
                  <span className="layer__index">{i + 1}</span>
                </label>
                <span className="layer__name" title={l.name}>
                  {l.name}
                </span>
                <div className="row row--tight">
                  <button className="icon" onClick={() => move(l.id, -1)} disabled={i === 0} title="Subir">
                    ↑
                  </button>
                  <button className="icon" onClick={() => move(l.id, 1)} disabled={i === layers.length - 1} title="Bajar">
                    ↓
                  </button>
                  <button className="icon" onClick={() => remove(l.id)} title="Quitar">
                    ✕
                  </button>
                </div>
              </div>
              <div className="layer__meta">
                {l.lut.kind} · {l.lut.kind === '3D' ? `${l.lut.size}³` : l.lut.size}
                {l.lut.title ? ` · ${l.lut.title}` : ''}
                {(l.lut.domainMin.some((v) => v !== 0) || l.lut.domainMax.some((v) => v !== 1)) &&
                  ` · dominio ${l.lut.domainMin[0]}–${l.lut.domainMax[0]}`}
              </div>
              <label className="slider">
                <span>Opacidad</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={l.opacity}
                  onChange={(e) => update(l.id, { opacity: Number(e.target.value) })}
                  onDoubleClick={() => update(l.id, { opacity: 1 })}
                />
                <output>{Math.round(l.opacity * 100)}%</output>
              </label>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
