import { DEFAULT_ANALYZE } from '../color/analyze'
import { OVERLAY_COLORS } from '../gpu/renderer'
import { Section, Slider } from './controls'
import { useApp } from './store'

const css = (c: readonly number[]) => `rgb(${c.map((x) => Math.round(x * 255)).join(' ')})`
const pct = (v: number) => (v === 0 ? '0 %' : v < 0.001 ? '< 0,1 %' : `${(v * 100).toFixed(1)} %`)
const n = (v: number) => v.toLocaleString('es')

function Row({
  color,
  label,
  checked,
  onChange,
  cells,
  pixels,
  title,
}: {
  color: string
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  cells: number
  pixels: number
  title: string
}) {
  return (
    <label className="alert" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i className="alert__swatch" style={{ background: color }} />
      <span className="alert__label">{label}</span>
      <span className="alert__num">
        {n(cells)}
      </span>
      <span className="alert__num">{pct(pixels)}</span>
    </label>
  )
}

/** Alertas del LUT horneado (antes del clamp final). Solo pantalla: nada de esto entra al .cube. */
export function AlertsPanel() {
  const a = useApp((s) => s.alerts)
  const d = useApp((s) => s.diagnostics)
  const busy = useApp((s) => s.diagBusy)
  const frames = useApp((s) => s.frames.length)
  const conv = useApp((s) => s.params.conversion.enabled)
  const set = useApp((s) => s.setAlerts)
  const px = d?.pixels

  return (
    <Section title="Alertas del LUT" defaultOpen={false} actions={busy ? <span className="hint">analizando…</span> : undefined}>
      {!d ? (
        <p className="hint">Analizando el LUT…</p>
      ) : (
        <>
          <div className="alert alert--head">
            <span />
            <span />
            <span className="alert__label">Overlay</span>
            <span className="alert__num">celdas de {n(d.full.cells)}</span>
            <span className="alert__num">{frames ? 'píxeles' : ''}</span>
          </div>
          <Row
            color={css(OVERLAY_COLORS.clipLow)}
            label="Recorte en sombras"
            checked={a.clip}
            onChange={(v) => set({ clip: v })}
            cells={d.full.clipLowCells}
            pixels={px?.clipLow ?? 0}
            title="Píxeles cuya salida, antes del clamp final, queda por debajo de 0. El overlay es exacto por píxel."
          />
          <Row
            color={css(OVERLAY_COLORS.clipHigh)}
            label="Recorte en altas"
            checked={a.clip}
            onChange={(v) => set({ clip: v })}
            cells={d.full.clipHighCells}
            pixels={px?.clipHigh ?? 0}
            title="Píxeles cuya salida, antes del clamp final, queda por encima de 1. El overlay es exacto por píxel."
          />
          <Row
            color={css(OVERLAY_COLORS.break)}
            label="Quiebres"
            checked={a.breaks}
            onChange={(v) => set({ breaks: v })}
            cells={d.look.breakCells}
            pixels={px?.break ?? 0}
            title="Nodos del look que se apartan de una curva suave mucho más que sus vecinos (picos, saltos). Se marcan los píxeles cuyos colores caen en esas celdas."
          />
          <Row
            color={css(OVERLAY_COLORS.inversion)}
            label="Inversiones"
            checked={a.inversions}
            onChange={(v) => set({ inversions: v })}
            cells={d.look.inversionCells}
            pixels={px?.inversion ?? 0}
            title="Tramos del look donde la luminancia de salida va en contra de la dirección de su línea de la grilla, o baja a lo largo del eje de grises."
          />
          <p className={d.look.grayInversions ? 'hint hint--strong' : 'hint'}>
            Eje de grises: {d.look.grayInversions ? `${d.look.grayInversions} tramos donde la luminancia baja` : 'monótono'}.
            {d.look.worstInversion > 0 && ` Peor inversión: ${(d.look.worstInversion * 100).toFixed(1)} % de luminancia.`}
          </p>
          <Slider
            label="Sensibilidad a quiebres"
            value={a.breakK}
            min={2}
            max={20}
            step={0.5}
            def={DEFAULT_ANALYZE.breakK}
            format={(v) => `×${v.toFixed(1)}`}
            onChange={(v) => set({ breakK: v })}
            title="Cuántas veces tiene que superar un nodo el desvío típico de sus vecinos para contar como quiebre. Menos = más sensible."
          />
          <Slider
            label="Tolerancia de inversión"
            value={a.inversionTol * 1000}
            min={0}
            max={50}
            step={1}
            def={DEFAULT_ANALYZE.inversionTol * 1000}
            format={(v) => `${(v / 10).toFixed(1)} %`}
            onChange={(v) => set({ inversionTol: v / 1000 })}
            title="Caída de luminancia lineal tolerada entre nodos vecinos"
          />
          <p className="hint">
            Recorte: LUT completo antes del clamp final ({d.size}³). Quiebres e inversiones: el look solo
            {conv ? ' (Rec.709 → Rec.709, sin la conversión)' : ''}, porque la conversión log → Rec.709 tiene rodillas y
            un gamut amplio que no son artefactos. Una celda cuenta si alguno de sus 8 nodos tiene el problema; "píxeles"
            es la fracción {frames > 1 ? `de los ${frames} frames` : 'del frame'} que cae en esas celdas (en el recorte, la
            que realmente sale de 0..1).
          </p>
        </>
      )}
    </Section>
  )
}
