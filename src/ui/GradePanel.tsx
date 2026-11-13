import { useState } from 'react'
import { hueSwatch } from '../color/oklab'
import { defaultParams, type HueCurveName, type LookParams, type RgbCurveName, type WheelName } from '../color/params'
import { ColorWheel } from './ColorWheel'
import { Section, Slider } from './controls'
import { CurveEditor } from './CurveEditor'
import { useApp } from './store'

const WHEELS: { id: WheelName; label: string; min: number; max: number; def: number }[] = [
  { id: 'lift', label: 'Lift', min: -0.5, max: 0.5, def: 0 },
  { id: 'gamma', label: 'Gamma', min: -1, max: 1, def: 0 },
  { id: 'gain', label: 'Gain', min: 0, max: 2, def: 1 },
  { id: 'offset', label: 'Offset', min: -0.5, max: 0.5, def: 0 },
]

const RGB_CURVES: { id: RgbCurveName; label: string; stroke?: string }[] = [
  { id: 'master', label: 'Y' },
  { id: 'r', label: 'R', stroke: '#b9a3a3' },
  { id: 'g', label: 'G', stroke: '#a3b9a5' },
  { id: 'b', label: 'B', stroke: '#a3a9bc' },
]

const HUE_CURVES: { id: HueCurveName; label: string; hint: string }[] = [
  { id: 'hueHue', label: 'Tono vs Tono', hint: 'Rota el tono (±60°) según el tono de partida.' },
  { id: 'hueSat', label: 'Tono vs Sat', hint: 'Multiplica la saturación (0 a ×2) según el tono.' },
  { id: 'hueLum', label: 'Tono vs Lum', hint: 'Sube o baja la luminancia según el tono. Los grises no cambian.' },
  { id: 'lumSat', label: 'Lum vs Sat', hint: 'Multiplica la saturación según la luminancia (izquierda = negro).' },
]

/** Banda de tonos de baja croma (orientativa: no satura la interfaz). */
function HueBand() {
  const stops = Array.from({ length: 13 }, (_, i) => i / 12)
  return (
    <>
      <defs>
        <linearGradient id="hueband" x1="0" x2="1" y1="0" y2="0">
          {stops.map((t) => (
            <stop key={t} offset={t} stopColor={hueSwatch(t, 0.5, 0.05)} />
          ))}
        </linearGradient>
      </defs>
      <rect x={0} y={172} width={280} height={8} fill="url(#hueband)" />
    </>
  )
}

export function GradePanel() {
  const params = useApp((s) => s.params)
  const update = useApp((s) => s.updateParams)
  const commit = useApp((s) => s.commit)
  const [rgbTab, setRgbTab] = useState<RgbCurveName>('master')
  const [hueTab, setHueTab] = useState<HueCurveName>('hueHue')
  const def = defaultParams()
  const g = params.grade
  const set = (fn: (p: LookParams) => void) => update(fn)

  const curveChanged = (id: RgbCurveName) => params.curves[id].some((p) => Math.abs(p.x - p.y) > 1e-9) || params.curves[id].length !== 2
  const hueChanged = (id: HueCurveName) => params.hueCurves[id].length > 0

  return (
    <>
      <Section
        title="Primarias"
        onReset={() => {
          set((p) => {
            p.grade.lift = def.grade.lift
            p.grade.gamma = def.grade.gamma
            p.grade.gain = def.grade.gain
            p.grade.offset = def.grade.offset
          })
          commit()
        }}
      >
        <div className="wheels">
          {WHEELS.map((w) => (
            <ColorWheel
              key={w.id}
              label={w.label}
              value={g[w.id]}
              masterMin={w.min}
              masterMax={w.max}
              masterDef={w.def}
              onChange={(v) => set((p) => void (p.grade[w.id] = v))}
              onCommit={commit}
            />
          ))}
        </div>
        <p className="hint">
          Arrastrá el punto para cambiar el color (Shift: ajuste fino); doble clic lo centra. El deslizador es el maestro.
          Operan sobre Rec.709 γ2.4, como las primarias de DaVinci.
        </p>
      </Section>

      <Section
        title="Contraste y saturación"
        onReset={() => {
          set((p) => {
            const d = def.grade
            Object.assign(p.grade, {
              contrast: d.contrast,
              pivot: d.pivot,
              saturation: d.saturation,
              satShadows: d.satShadows,
              satMids: d.satMids,
              satHighs: d.satHighs,
            })
          })
          commit()
        }}
      >
        <Slider label="Contraste" value={g.contrast} min={0} max={2} def={1} step={0.001} onChange={(v) => set((p) => void (p.grade.contrast = v))} onCommit={commit} />
        <Slider label="Pivote" value={g.pivot} min={0} max={1} def={def.grade.pivot} step={0.001} format={(v) => v.toFixed(3)} onChange={(v) => set((p) => void (p.grade.pivot = v))} onCommit={commit} />
        <Slider label="Saturación" value={g.saturation} min={0} max={2} def={1} step={0.001} onChange={(v) => set((p) => void (p.grade.saturation = v))} onCommit={commit} />
        <Slider label="Sat. sombras" value={g.satShadows} min={0} max={2} def={1} step={0.001} onChange={(v) => set((p) => void (p.grade.satShadows = v))} onCommit={commit} />
        <Slider label="Sat. medios" value={g.satMids} min={0} max={2} def={1} step={0.001} onChange={(v) => set((p) => void (p.grade.satMids = v))} onCommit={commit} />
        <Slider label="Sat. altas" value={g.satHighs} min={0} max={2} def={1} step={0.001} onChange={(v) => set((p) => void (p.grade.satHighs = v))} onCommit={commit} />
        <p className="hint">La saturación se calcula en Oklab: cambia la croma sin mover la luminancia percibida.</p>
      </Section>

      <Section
        title="Curvas"
        onReset={() => {
          set((p) => void (p.curves = def.curves))
          commit()
        }}
      >
        <div className="tabs-mini">
          {RGB_CURVES.map((c) => (
            <button key={c.id} className={rgbTab === c.id ? 'on' : ''} onClick={() => setRgbTab(c.id)}>
              {c.label}
              {curveChanged(c.id) ? ' •' : ''}
            </button>
          ))}
          <button
            className="icon"
            title="Restablecer esta curva"
            disabled={!curveChanged(rgbTab)}
            onClick={() => {
              set((p) => void (p.curves[rgbTab] = def.curves[rgbTab]))
              commit()
            }}
          >
            ↺
          </button>
        </div>
        <CurveEditor
          kind="rgb"
          points={params.curves[rgbTab]}
          stroke={RGB_CURVES.find((c) => c.id === rgbTab)?.stroke}
          onChange={(pts) => set((p) => void (p.curves[rgbTab] = pts))}
          onCommit={commit}
        />
        <p className="hint">Clic: agrega un punto · arrastrar: mueve · doble clic: borra. Splines monótonas, sin overshoot.</p>
      </Section>

      <Section
        title="Curvas de tono (OkLCh)"
        defaultOpen={false}
        onReset={() => {
          set((p) => void (p.hueCurves = def.hueCurves))
          commit()
        }}
      >
        <div className="tabs-mini">
          {HUE_CURVES.map((c) => (
            <button key={c.id} className={hueTab === c.id ? 'on' : ''} onClick={() => setHueTab(c.id)}>
              {c.label}
              {hueChanged(c.id) ? ' •' : ''}
            </button>
          ))}
        </div>
        <CurveEditor
          kind={hueTab === 'lumSat' ? 'lum' : 'hue'}
          points={params.hueCurves[hueTab]}
          background={hueTab === 'lumSat' ? undefined : <HueBand />}
          onChange={(pts) => set((p) => void (p.hueCurves[hueTab] = pts))}
          onCommit={commit}
        />
        <div className="row row--between">
          <p className="hint">{HUE_CURVES.find((c) => c.id === hueTab)?.hint}</p>
          <button
            className="icon"
            title="Restablecer esta curva"
            disabled={!hueChanged(hueTab)}
            onClick={() => {
              set((p) => void (p.hueCurves[hueTab] = []))
              commit()
            }}
          >
            ↺
          </button>
        </div>
      </Section>

      <Section
        title="Split toning"
        defaultOpen={false}
        onReset={() => {
          set((p) => void (p.splitTone = def.splitTone))
          commit()
        }}
      >
        <Slider label="Tono sombras" value={params.splitTone.shadowHue} min={0} max={360} step={1} def={def.splitTone.shadowHue} format={(v) => `${v.toFixed(0)}°`} onChange={(v) => set((p) => void (p.splitTone.shadowHue = v))} onCommit={commit} />
        <Slider label="Cant. sombras" value={params.splitTone.shadowAmount} min={0} max={1} def={0} onChange={(v) => set((p) => void (p.splitTone.shadowAmount = v))} onCommit={commit} />
        <Slider label="Tono altas" value={params.splitTone.highHue} min={0} max={360} step={1} def={def.splitTone.highHue} format={(v) => `${v.toFixed(0)}°`} onChange={(v) => set((p) => void (p.splitTone.highHue = v))} onCommit={commit} />
        <Slider label="Cant. altas" value={params.splitTone.highAmount} min={0} max={1} def={0} onChange={(v) => set((p) => void (p.splitTone.highAmount = v))} onCommit={commit} />
        <Slider label="Balance" value={params.splitTone.balance} min={-1} max={1} def={0} onChange={(v) => set((p) => void (p.splitTone.balance = v))} onCommit={commit} />
        <p className="hint">Los tonos son ángulos OkLCh. Balance + desplaza el límite hacia las altas.</p>
      </Section>
    </>
  )
}
