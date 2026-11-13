import { useRef } from 'react'
import type { Wheel } from '../color/params'

const R = 46

/**
 * Rueda de color: el punto se mueve en el disco (x = Cb, y = Cr, como un vectorscopio) y el
 * deslizador de abajo es el control maestro. Doble clic en la rueda: vuelve el color a neutro.
 * El disco es gris: la interfaz no muestra colores saturados que afecten la percepción.
 */
export function ColorWheel({
  label,
  value,
  masterMin,
  masterMax,
  masterDef,
  masterStep = 0.001,
  onChange,
  onCommit,
}: {
  label: string
  value: Wheel
  masterMin: number
  masterMax: number
  masterDef: number
  masterStep?: number
  onChange: (w: Wheel) => void
  /** se llama al soltar (para el historial de deshacer) */
  onCommit?: () => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)

  const setFromEvent = (e: React.PointerEvent, fine: boolean) => {
    const rect = svgRef.current!.getBoundingClientRect()
    let x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    let y = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
    const r = Math.hypot(x, y)
    if (r > 1) {
      x /= r
      y /= r
    }
    if (fine) {
      x = value.x + (x - value.x) * 0.2
      y = value.y + (y - value.y) * 0.2
    }
    onChange({ ...value, x, y })
  }

  const changed = value.x !== 0 || value.y !== 0 || value.master !== masterDef
  return (
    <div className={changed ? 'wheel wheel--changed' : 'wheel'}>
      <div className="wheel__head">
        <span>{label}</span>
        <button
          className="icon slider__reset"
          disabled={!changed}
          title={`Restablecer ${label}`}
          onClick={() => {
            onChange({ x: 0, y: 0, master: masterDef })
            onCommit?.()
          }}
        >
          ↺
        </button>
      </div>
      <svg
        ref={svgRef}
        className="wheel__disc"
        viewBox={`${-R - 4} ${-R - 4} ${2 * R + 8} ${2 * R + 8}`}
        onPointerDown={(e) => {
          ;(e.target as Element).setPointerCapture(e.pointerId)
          setFromEvent(e, e.shiftKey)
        }}
        onPointerMove={(e) => e.buttons & 1 && setFromEvent(e, e.shiftKey)}
        onPointerUp={() => onCommit?.()}
        onDoubleClick={() => {
          onChange({ ...value, x: 0, y: 0 })
          onCommit?.()
        }}
      >
        <circle r={R} className="wheel__ring" />
        <circle r={R * 0.5} className="wheel__guide" />
        <line x1={-R} x2={R} y1={0} y2={0} className="wheel__guide" />
        <line y1={-R} y2={R} x1={0} x2={0} className="wheel__guide" />
        <text x={0} y={-R + 9} className="wheel__tick">R</text>
        <text x={R - 9} y={3} className="wheel__tick">B</text>
        <circle cx={value.x * R} cy={-value.y * R} r={4.5} className="wheel__dot" />
      </svg>
      <input
        type="range"
        min={masterMin}
        max={masterMax}
        step={masterStep}
        value={value.master}
        onChange={(e) => onChange({ ...value, master: Number(e.target.value) })}
        onPointerUp={() => onCommit?.()}
        onKeyUp={() => onCommit?.()}
        onDoubleClick={() => {
          onChange({ ...value, master: masterDef })
          onCommit?.()
        }}
        title="Control maestro de luminancia (doble clic: restablecer)"
      />
      <output className="wheel__values">
        {value.master.toFixed(3)} · {value.x.toFixed(2)} {value.y.toFixed(2)}
      </output>
    </div>
  )
}
