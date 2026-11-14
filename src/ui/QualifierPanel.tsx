import { useEffect, useState } from 'react'
import { analyzeLut } from '../color/analyze'
import type { Lut3D } from '../color/lut'
import { hueSwatch } from '../color/oklab'
import { defaultParams } from '../color/params'
import { bakeCpu, prepare } from '../color/pipeline'
import { MAX_QUALIFIERS, newQualifier, prepareQualifiers, type Qualifier, type Window1 } from '../color/qualifiers'
import { Section, Slider, Toggle } from './controls'
import { useApp } from './store'

const deg = (v: number) => `${v.toFixed(0)}°`
const f3 = (v: number) => v.toFixed(3)
const f2 = (v: number) => v.toFixed(2)

interface QualAlerts {
  size: number
  breaks: number
  inversions: number
}

/** Análisis de la etapa 2 sobre las correcciones solas (Rec.709 -> Rec.709), en 33³ y 65³, con debounce. */
function useQualifierAlerts(list: Qualifier[]): QualAlerts[] | null {
  const [res, setRes] = useState<QualAlerts[] | null>(null)
  useEffect(() => {
    if (!prepareQualifiers(list).length) {
      setRes(null)
      return
    }
    const t = setTimeout(() => {
      const p = defaultParams()
      p.conversion.enabled = false
      p.output.clamp = false
      p.qualifiers = structuredClone(list)
      const prepared = prepare(p, { conversionLut: null, creativeLut: null }, 'tetrahedral')
      setRes(
        [33, 65].map((size) => {
          const d = analyzeLut(bakeCpu(prepared, size) as Lut3D)
          return { size, breaks: d.breakCells, inversions: d.inversionCells }
        }),
      )
    }, 400)
    return () => clearTimeout(t)
  }, [list])
  return res
}

function WindowSliders({
  label,
  w,
  def,
  ranges,
  format,
  onChange,
}: {
  label: string
  w: Window1
  def: Window1
  ranges: [number, number, number, number]
  format: (v: number) => string
  onChange: (w: Window1) => void
}) {
  const [max, maxW, maxS, step] = ranges
  return (
    <div className="qual__window">
      <span className="qual__axis">{label}</span>
      <Slider label="Centro" value={w.center} min={0} max={max} step={step} def={def.center} format={format} onChange={(v) => onChange({ ...w, center: v })} />
      <Slider label="Ancho" value={w.width} min={0} max={maxW} step={step} def={def.width} format={format} onChange={(v) => onChange({ ...w, width: v })} />
      <Slider label="Suavidad" value={w.soft} min={0} max={maxS} step={step} def={def.soft} format={format} onChange={(v) => onChange({ ...w, soft: v })} />
    </div>
  )
}

function QualifierCard({ q, index }: { q: Qualifier; index: number }) {
  const update = useApp((s) => s.updateParams)
  const picking = useApp((s) => s.picking)
  const maskView = useApp((s) => s.qualMaskView)
  const hasImage = useApp((s) => s.image !== null)
  const st = useApp.getState()
  const set = (fn: (t: Qualifier) => void) =>
    update((p) => {
      const t = p.qualifiers[index]
      if (t) fn(t)
    })
  const def = newQualifier()
  const title = q.name || `Color ${index + 1}`
  return (
    <details className="qual" open>
      <summary className="qual__head">
        <i className="qual__swatch" style={{ background: hueSwatch(q.hue.center / 360, Math.min(0.8, Math.max(0.35, q.luma.center)), Math.min(0.15, q.chroma.center)) }} />
        <input
          className="qual__name"
          value={q.name}
          placeholder={`Color ${index + 1}`}
          onChange={(e) => set((t) => void (t.name = e.target.value))}
          onClick={(e) => e.stopPropagation()}
          aria-label="Nombre de la corrección"
        />
        <span className="row row--tight" onClick={(e) => e.preventDefault()}>
          <button
            className={picking === index ? 'icon on' : 'icon'}
            disabled={!hasImage}
            title="Gotero: tomá el color con un clic sobre la imagen (Esc cancela)"
            onClick={() => st.setPicking(picking === index ? null : index)}
          >
            ⌖
          </button>
          <button
            className={maskView === index ? 'icon on' : 'icon'}
            title="Ver la máscara: en blanco lo que afecta esta corrección (solo pantalla)"
            onClick={() => st.setQualMaskView(maskView === index ? null : index)}
          >
            ◐
          </button>
          <button
            className="icon"
            title={`Restablecer ${title} (mantiene el nombre)`}
            onClick={() => {
              set((t) => Object.assign(t, { ...newQualifier(t.name), id: t.id }))
              st.commit()
            }}
          >
            ↺
          </button>
          <button
            className="icon"
            title={`Quitar ${title}`}
            onClick={() => {
              if (maskView === index) st.setQualMaskView(null)
              if (picking === index) st.setPicking(null)
              update((p) => void p.qualifiers.splice(index, 1))
              st.commit()
            }}
          >
            ✕
          </button>
        </span>
      </summary>
      <Toggle label="Activa" checked={q.enabled} onChange={(v) => set((t) => void (t.enabled = v))} />
      <p className="qual__group">Selección (OkLCh)</p>
      <WindowSliders label="Tono" w={q.hue} def={def.hue} ranges={[360, 180, 90, 1]} format={deg} onChange={(w) => set((t) => void (t.hue = w))} />
      <WindowSliders label="Croma" w={q.chroma} def={def.chroma} ranges={[0.4, 0.4, 0.2, 0.001]} format={f3} onChange={(w) => set((t) => void (t.chroma = w))} />
      <WindowSliders label="Luminancia" w={q.luma} def={def.luma} ranges={[1, 1, 0.5, 0.005]} format={f2} onChange={(w) => set((t) => void (t.luma = w))} />
      <p className="qual__group">Ajustes</p>
      <Slider label="Tono" value={q.adjust.hue} min={-180} max={180} step={1} def={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}°`} onChange={(v) => set((t) => void (t.adjust.hue = v))} title="Lleva el color seleccionado hacia otro tono" />
      <Slider label="Saturación" value={q.adjust.sat} min={0} max={2} def={1} format={(v) => `×${v.toFixed(2)}`} onChange={(v) => set((t) => void (t.adjust.sat = v))} />
      <Slider label="Luminancia" value={q.adjust.lum} min={-0.3} max={0.3} step={0.005} def={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(3)}`} onChange={(v) => set((t) => void (t.adjust.lum = v))} />
      <Slider label="Intensidad" value={q.intensity} min={0} max={1} def={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((t) => void (t.intensity = v))} />
    </details>
  )
}

/** Correcciones por color (qualifiers): después de primarias, curvas y Oklab; antes del LUT creativo. */
export function QualifierPanel() {
  const list = useApp((s) => s.params.qualifiers)
  const update = useApp((s) => s.updateParams)
  const eyedropper = useApp((s) => s.eyedropperSize)
  const alerts = useQualifierAlerts(list)
  const st = useApp.getState()
  const bad = alerts?.find((a) => a.breaks || a.inversions)

  return (
    <Section
      title="Colores"
      defaultOpen={list.length > 0}
      onReset={() => {
        st.setQualMaskView(null)
        st.setPicking(null)
        update((p) => void (p.qualifiers = []))
        st.commit()
      }}
    >
      {list.map((q, i) => (
        <QualifierCard key={q.id} q={q} index={i} />
      ))}
      <div className="row row--between">
        <button
          disabled={list.length >= MAX_QUALIFIERS}
          onClick={() => {
            const i = list.length
            update((p) => void p.qualifiers.push(newQualifier()))
            st.commit()
            if (st.image) st.setPicking(i)
          }}
          title={`Hasta ${MAX_QUALIFIERS} correcciones. Con una imagen abierta, arranca con el gotero activo.`}
        >
          + Color
        </button>
        <label className="field" title="Lado del área que promedia el gotero">
          <span>Gotero</span>
          <select value={eyedropper} onChange={(e) => st.setEyedropperSize(Number(e.target.value))}>
            {[1, 3, 5, 9, 15].map((n) => (
              <option key={n} value={n}>
                {n}×{n} px
              </option>
            ))}
          </select>
        </label>
      </div>
      {alerts && (
        <p className={bad ? 'issue' : 'hint'}>
          {alerts.map((a) => `${a.size}³: ${a.breaks} celdas con quiebres, ${a.inversions} con inversiones`).join(' · ')}.
          {bad &&
            ' Una corrección localizada necesita bordes suaves: subí la suavidad o exportá en 65³. Subir o bajar la luminancia solo en una zona produce inversiones esperables (la luminancia sube y baja al cruzar la zona).'}
        </p>
      )}
      <p className="hint">
        El gotero toma el color en ese punto del pipeline (antes de esta corrección), promediando el área elegida. La
        selección es suave en tono, croma y luminancia, para no generar quiebres en el LUT. La máscara y el gotero son solo
        de pantalla.
      </p>
    </Section>
  )
}
