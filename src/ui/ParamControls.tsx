/** Controles que salen del esquema de parámetros: rango, paso, valor neutro y texto de ayuda. */
import { getParam, numberParam, PARAM_BY_ID, setParam } from '../params/schema'
import { Slider, Toggle } from './controls'
import { useApp } from './store'

const autoFormat = (unit: string, step: number) => (v: number) => {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
  const t = v.toFixed(digits)
  if (unit === '°') return `${t}°`
  if (unit === '×') return `×${t}`
  return unit ? `${t} ${unit}` : t
}

export function ParamSlider({
  id,
  label,
  format,
  disabled,
}: {
  id: string
  /** etiqueta corta para la interfaz (por defecto, el nombre del esquema) */
  label?: string
  format?: (v: number) => string
  disabled?: boolean
}) {
  const p = numberParam(id)
  const value = useApp((s) => getParam(s.params, id) as number)
  const update = useApp((s) => s.updateParams)
  return (
    <Slider
      label={label ?? p.name}
      value={value}
      min={p.min}
      max={p.max}
      step={p.step}
      def={p.neutral}
      disabled={disabled}
      format={format ?? autoFormat(p.unit, p.step)}
      title={p.description}
      onChange={(v) => update((pp) => setParam(pp, id, v))}
      onCommit={() => useApp.getState().commit()}
    />
  )
}

export function ParamToggle({ id, label }: { id: string; label?: string }) {
  const p = PARAM_BY_ID.get(id)
  if (!p || p.type !== 'boolean') throw new Error(`"${id}" no es un parámetro booleano del esquema.`)
  const value = useApp((s) => getParam(s.params, id) as boolean)
  const update = useApp((s) => s.updateParams)
  return <Toggle label={label ?? p.name} checked={value} title={p.description} onChange={(v) => update((pp) => setParam(pp, id, v))} />
}
