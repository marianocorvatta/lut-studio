import { useEffect, useMemo, useRef, useState } from 'react'
import type { Wheel } from '../color/params'
import { cssRgb, hueColor, REC709_VECTORS } from '../color/vectors'

/** radio del disco y margen para las etiquetas, en unidades del viewBox */
const R = 46
const PAD = 13
const VB = 2 * (R + PAD)
const HUE_DOTS = 120

/**
 * Referencias de la rueda, en unidades del viewBox. `u` = unidades por píxel CSS, así los trazos y puntos
 * miden lo mismo en pantalla sea cual sea el tamaño de la rueda (SVG: nítido en Retina sin más).
 * Misma orientación que el vectorscopio: +Cb a la derecha, +Cr arriba (y de SVG invertida).
 */
function WheelGuides({ u }: { u: number }) {
  return useMemo(() => {
    const pos = (deg: number, r: number): [number, number] => {
      const a = (deg * Math.PI) / 180
      return [Math.cos(a) * r, -Math.sin(a) * r]
    }
    const dotted = { strokeWidth: 0.5 * u, strokeDasharray: `${0.5 * u} ${1.5 * u}` }
    const ringR = R + 2.5 * u
    const sq = 3 * u
    return (
      <g className="wheel__refs" pointerEvents="none">
        <circle r={R} className="wheel__guide" style={dotted} />
        <circle r={R * 0.5} className="wheel__guide" style={dotted} />
        <line x1={-R} x2={R} y1={0} y2={0} className="wheel__guide" style={dotted} />
        <line y1={-R} y2={R} x1={0} x2={0} className="wheel__guide" style={dotted} />
        {Array.from({ length: HUE_DOTS }, (_, i) => {
          const deg = (i * 360) / HUE_DOTS
          const [x, y] = pos(deg, ringR)
          return <circle key={i} cx={x} cy={y} r={1.1 * u} fill={cssRgb(hueColor(deg))} opacity={0.7} />
        })}
        {REC709_VECTORS.map((v) => {
          const [mx, my] = pos(v.angle, R - 2.5 * u - sq / 2)
          const [lx, ly] = pos(v.angle, ringR + 7 * u)
          return (
            <g key={v.name}>
              <line x1={0} y1={0} x2={mx} y2={my} className="wheel__spoke" style={dotted} />
              <rect
                x={mx - sq / 2}
                y={my - sq / 2}
                width={sq}
                height={sq}
                fill="none"
                stroke={cssRgb(hueColor(v.angle, 0.4, 0.5))}
                strokeWidth={u}
              />
              <text x={lx} y={ly} className="wheel__tick" style={{ fontSize: 7.5 * u }}>
                {v.name}
              </text>
            </g>
          )
        })}
      </g>
    )
  }, [u])
}

/**
 * Rueda de color: el punto se mueve en el disco (x = Cb, y = Cr, como un vectorscopio) y el
 * deslizador de abajo es el control maestro. Doble clic en la rueda: vuelve el color a neutro.
 * El disco es gris; el anillo de tono y las marcas de los vectores tienen croma moderada para orientar
 * sin competir con la imagen.
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
  const [u, setU] = useState(1)

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width
      if (w > 0) setU(VB / w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const setFromEvent = (e: React.PointerEvent, fine: boolean) => {
    const rect = svgRef.current!.getBoundingClientRect()
    // píxeles -> unidades del viewBox -> radio del disco = 1
    let x = (((e.clientX - rect.left) / rect.width) * VB - VB / 2) / R
    let y = -((((e.clientY - rect.top) / rect.height) * VB - VB / 2) / R)
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
        viewBox={`${-VB / 2} ${-VB / 2} ${VB} ${VB}`}
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
        <WheelGuides u={u} />
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
