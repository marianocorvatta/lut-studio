/**
 * Historial de deshacer/rehacer de los parámetros del look (puro, sin React).
 * `commit` registra el estado actual como un paso; los cambios intermedios de un arrastre no se guardan.
 */
import type { LookParams } from '../color/params'

export interface History {
  past: LookParams[]
  future: LookParams[]
  /** último estado registrado */
  committed: LookParams
}

export const HISTORY_LIMIT = 200

export const newHistory = (p: LookParams): History => ({ past: [], future: [], committed: p })

const same = (a: LookParams, b: LookParams) => a === b || JSON.stringify(a) === JSON.stringify(b)

export function commitHistory(h: History, current: LookParams): History {
  if (same(h.committed, current)) return h
  return { past: [...h.past, h.committed].slice(-HISTORY_LIMIT), future: [], committed: current }
}

export function undoHistory(h: History, current: LookParams): { h: History; params: LookParams } | null {
  const base = commitHistory(h, current) // un cambio sin registrar se registra antes de deshacer
  const prev = base.past[base.past.length - 1]
  if (!prev) return null
  return { h: { past: base.past.slice(0, -1), future: [base.committed, ...base.future], committed: prev }, params: prev }
}

export function redoHistory(h: History, current: LookParams): { h: History; params: LookParams } | null {
  if (!same(h.committed, current)) return null // hubo un cambio nuevo: no hay nada para rehacer
  const next = h.future[0]
  if (!next) return null
  return { h: { past: [...h.past, h.committed], future: h.future.slice(1), committed: next }, params: next }
}
