import type { ReactNode } from 'react'

export function Section({
  title,
  children,
  onReset,
  actions,
  defaultOpen = true,
}: {
  title: string
  children: ReactNode
  onReset?: () => void
  actions?: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details className="group" open={defaultOpen}>
      <summary className="group__head">
        <h2>{title}</h2>
        <div className="row row--tight" onClick={(e) => e.preventDefault()}>
          {actions}
          {onReset && (
            <button className="icon" title={`Restablecer ${title}`} onClick={onReset}>
              ↺
            </button>
          )}
        </div>
      </summary>
      <div className="group__body">{children}</div>
    </details>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  def,
  onChange,
  format,
  disabled,
  title,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  /** valor por defecto (doble clic o botón para restablecer) */
  def: number
  onChange: (v: number) => void
  format?: (v: number) => string
  disabled?: boolean
  title?: string
}) {
  const text = format ? format(value) : value.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3)
  return (
    <label className={value !== def ? 'slider slider--changed' : 'slider'} title={title}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(def)}
      />
      <output>{text}</output>
      <button className="icon slider__reset" title="Restablecer" disabled={disabled || value === def} onClick={(e) => (e.preventDefault(), onChange(def))}>
        ↺
      </button>
    </label>
  )
}

export function Toggle({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function LutSlot({
  label,
  name,
  meta,
  onLoad,
  onClear,
}: {
  label: string
  name: string | null
  meta?: string
  onLoad: () => void
  onClear: () => void
}) {
  return (
    <div className="slot">
      <div className="slot__text">
        <span className="slot__name" title={name ?? undefined}>
          {name ?? `Sin ${label}`}
        </span>
        {meta && <span className="slot__meta">{meta}</span>}
      </div>
      <button onClick={onLoad}>{name ? 'Cambiar…' : 'Cargar .cube…'}</button>
      {name && (
        <button className="icon" onClick={onClear} title="Quitar">
          ✕
        </button>
      )}
    </div>
  )
}
