import { useMemo, useRef, useState } from 'react'
import { monotoneSpline, periodicSpline } from '../color/curves'
import type { Pt } from '../color/params'

const W = 280
const H = 180

export interface CurveEditorProps {
  points: Pt[]
  onChange: (pts: Pt[]) => void
  onCommit?: () => void
  /** 'rgb': x,y en 0..1 con diagonal; 'hue': x periódico 0..1, y en -1..1 con 0 = sin cambio; 'lum': x en 0..1, y en -1..1 */
  kind: 'rgb' | 'hue' | 'lum'
  /** fondo opcional (por ejemplo, la banda de tonos) */
  background?: React.ReactNode
  /** color de la línea de la curva (gris por defecto) */
  stroke?: string
}

/**
 * Editor de curvas: clic en un lugar vacío agrega un punto, arrastrar lo mueve,
 * doble clic sobre un punto lo borra. Los extremos de una curva RGB no se pueden borrar.
 */
export function CurveEditor({ points, onChange, onCommit, kind, background, stroke }: CurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const yMin = kind === 'rgb' ? 0 : -1
  const yMax = 1
  const toX = (x: number) => x * W
  const toY = (y: number) => H - ((y - yMin) / (yMax - yMin)) * H
  const fromEvent = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(yMax, Math.max(yMin, yMax - ((e.clientY - rect.top) / rect.height) * (yMax - yMin)))
    return { x, y }
  }

  const path = useMemo(() => {
    if (kind !== 'rgb' && points.length === 0) return `M0 ${toY(0)} H${W}`
    const f = kind === 'hue' ? periodicSpline(points) : monotoneSpline(points)
    let d = ''
    for (let i = 0; i <= 160; i++) {
      const x = i / 160
      d += `${i ? 'L' : 'M'}${toX(x).toFixed(1)} ${toY(Math.min(yMax, Math.max(yMin, f(x)))).toFixed(1)}`
    }
    return d
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, kind])

  const isEndpoint = (i: number) => kind === 'rgb' && (i === 0 || i === points.length - 1)

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const p = fromEvent(e)
    const rect = svgRef.current!.getBoundingClientRect()
    const hit = points.findIndex(
      (q) => Math.hypot(((q.x - p.x) * rect.width) / 1, ((q.y - p.y) / (yMax - yMin)) * rect.height) < 9,
    )
    if (hit >= 0) {
      setDrag(hit)
      return
    }
    const next = [...points, p].sort((a, b) => a.x - b.x)
    setDrag(next.indexOf(p))
    onChange(next)
  }
  const onMove = (e: React.PointerEvent) => {
    if (drag === null) return
    let p = fromEvent(e)
    if (isEndpoint(drag)) p = { x: points[drag].x, y: p.y }
    else if (kind === 'rgb') {
      // un punto interior no cruza a sus vecinos (la curva sigue siendo una función)
      const lo = points[drag - 1]?.x ?? 0
      const hi = points[drag + 1]?.x ?? 1
      p = { x: Math.min(hi - 0.01, Math.max(lo + 0.01, p.x)), y: p.y }
    }
    const next = points.slice()
    next[drag] = p
    onChange(kind === 'rgb' ? next : next.slice().sort((a, b) => a.x - b.x))
    if (kind !== 'rgb') setDrag(next.slice().sort((a, b) => a.x - b.x).indexOf(p))
  }
  const onUp = () => {
    if (drag !== null) onCommit?.()
    setDrag(null)
  }
  const remove = (i: number) => {
    if (isEndpoint(i)) return
    onChange(points.filter((_, k) => k !== i))
    onCommit?.()
  }

  return (
    <svg
      ref={svgRef}
      className="curve"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {background}
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g} className="curve__grid">
          <line x1={toX(g)} x2={toX(g)} y1={0} y2={H} />
          <line x1={0} x2={W} y1={g * H} y2={g * H} />
        </g>
      ))}
      {kind === 'rgb' ? (
        <line x1={0} y1={H} x2={W} y2={0} className="curve__ref" />
      ) : (
        <line x1={0} y1={toY(0)} x2={W} y2={toY(0)} className="curve__ref" />
      )}
      <path d={path} className="curve__line" style={stroke ? { stroke } : undefined} />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={toX(p.x)}
          cy={toY(p.y)}
          r={4}
          className={drag === i ? 'curve__pt curve__pt--on' : 'curve__pt'}
          onDoubleClick={(e) => {
            e.stopPropagation()
            remove(i)
          }}
        />
      ))}
    </svg>
  )
}
