import { useEffect, useMemo, useState } from 'react'
import { analyzeLut, type LutDiagnostics } from '../color/analyze'
import type { Lut3D } from '../color/lut'
import { defaultParams } from '../color/params'
import { bakeCpu, prepare } from '../color/pipeline'
import { Section, Slider, Toggle } from './controls'
import { computeMatch, matchSourceKey, pickReference } from './matchActions'
import { useApp } from './store'

type MatchAlerts = Omit<LutDiagnostics, 'nodeFlags'>

/** Análisis de la etapa 2 sobre el match solo (Rec.709 -> Rec.709, 33³), con debounce. */
function useMatchAlerts(): MatchAlerts | null {
  const match = useApp((s) => s.params.match)
  const [res, setRes] = useState<MatchAlerts | null>(null)
  useEffect(() => {
    if (!match.model || !match.enabled) {
      setRes(null)
      return
    }
    const t = setTimeout(() => {
      const p = defaultParams()
      p.conversion.enabled = false
      p.output.clamp = false
      p.match = structuredClone(match)
      const { nodeFlags: _f, ...summary } = analyzeLut(bakeCpu(prepare(p, { conversionLut: null, creativeLut: null }, 'tetrahedral'), 33) as Lut3D)
      void _f
      setRes(summary)
    }, 300)
    return () => clearTimeout(t)
  }, [match])
  return res
}

export function MatchPanel() {
  const match = useApp((s) => s.params.match)
  const update = useApp((s) => s.updateParams)
  const reference = useApp((s) => s.reference)
  const missing = useApp((s) => s.missingReference)
  const embed = useApp((s) => s.embedReference)
  const frames = useApp((s) => s.frames.length)
  const matchKey = useApp((s) => s.matchKey)
  // recalcular la huella cuando cambian los datos de origen
  const frameIds = useApp((s) => s.frames)
  const input = useApp((s) => s.params.input)
  const conversion = useApp((s) => s.params.conversion)
  const convLut = useApp((s) => s.conversionLut)
  const interp = useApp((s) => s.interpolation)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = useMemo(() => matchSourceKey(), [frameIds, input, conversion, convLut, interp])
  const stale = Boolean(match.model && matchKey && matchKey !== key)
  const alerts = useMatchAlerts()
  const url = useMemo(() => (reference ? URL.createObjectURL(new Blob([reference.bytes])) : null), [reference])
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])
  const def = defaultParams().match

  return (
    <Section
      title="Match con referencia"
      onReset={() => update((p) => void (p.match = { ...def }))}
      defaultOpen={Boolean(match.model)}
    >
      <div className="match__ref">
        {url ? <img src={url} alt="" className="match__thumb" /> : <div className="match__thumb match__thumb--empty">Sin referencia</div>}
        <div className="match__meta">
          {reference ? (
            <>
              <span className="slot__name">{reference.name}</span>
              <span className="hint">
                {reference.width}×{reference.height} · {reference.profile}
              </span>
            </>
          ) : missing ? (
            <span className="hint">El proyecto usa "{missing.name}": cargala para recalcular. El match guardado se sigue usando.</span>
          ) : (
            <span className="hint">Una foto o un frame con el look que buscás (JPEG, PNG o TIFF).</span>
          )}
          <div className="row">
            <button onClick={() => void pickReference()}>{reference ? 'Cambiar…' : 'Cargar referencia…'}</button>
            {match.model && (
              <button onClick={() => update((p) => void (p.match.model = null))} title="Quita el match del look">
                Quitar match
              </button>
            )}
          </div>
        </div>
      </div>

      {match.model && (
        <>
          <Toggle label="Activo" checked={match.enabled} onChange={(v) => update((p) => void (p.match.enabled = v))} />
          <Slider
            label="Intensidad"
            value={match.intensity}
            min={0}
            max={1}
            def={1}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => update((p) => void (p.match.intensity = v))}
          />
          <Toggle
            label="Proteger piel"
            checked={match.protectSkin}
            onChange={(v) => update((p) => void (p.match.protectSkin = v))}
            title="Reduce el efecto cerca del tono de piel (el eje I de YIQ, la línea del vectorscopio)"
          />
          <p className="hint">
            Calculado con {match.model.info.frames} frame{match.model.info.frames === 1 ? '' : 's'} ({match.model.info.samples.toLocaleString('es')}{' '}
            muestras) y "{match.model.info.reference}". Después del match se puede seguir ajustando con todas las herramientas.
          </p>
          {alerts && (
            <p className={alerts.breakCells || alerts.inversionCells || alerts.grayInversions ? 'issue' : 'hint'}>
              {alerts.breakCells || alerts.inversionCells || alerts.grayInversions
                ? `Alertas del match (33³): ${alerts.breakCells} celdas con quiebres, ${alerts.inversionCells} con inversiones${
                    alerts.grayInversions ? `, ${alerts.grayInversions} tramos del eje de grises que bajan` : ''
                  }. Bajá la intensidad o revisá la referencia; el detalle está en "Alertas del LUT".`
                : 'Análisis del match (33³): sin quiebres ni inversiones.'}
            </p>
          )}
        </>
      )}

      {reference && (
        <div className="row">
          <button onClick={computeMatch} disabled={!frames} title="Vuelve a calcular las estadísticas con los frames y la conversión actuales">
            Recalcular con los frames actuales
          </button>
        </div>
      )}
      {stale && <p className="hint hint--strong">Cambiaron los frames, la entrada o la conversión desde que se calculó: recalculá para actualizarlo.</p>}
      {reference && (
        <Toggle label="Incluir la referencia en el proyecto" checked={embed} onChange={(v) => useApp.getState().setEmbedReference(v)} />
      )}
      <p className="hint">
        Al comienzo de la etapa creativa, en Oklab: una curva de luminancia monótona y suave que acerca el histograma de los
        frames al de la referencia, y un ajuste de (a, b) por sombras, medios y altas que acerca media y covarianza. Usa las
        estadísticas de todos los frames cargados. La referencia se convierte a Rec.709 γ2.4 según su perfil ICC.
      </p>
    </Section>
  )
}
