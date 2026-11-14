import { create } from 'zustand'
import type { Interpolation, Lut } from '../color/lut'
import { defaultParams, type LookParams, type LutSize } from '../color/params'
import type { CompareMode, DisplayTransform } from '../gpu/renderer'
import type { ScopeMode } from '../gpu/scopes'
import type { FloatImage } from '../io/image'
import type { FrameRef, LutRef } from '../io/project'
import type { CompareStats } from '../color/compare'
import { DEFAULT_ANALYZE } from '../color/analyze'
import type { WorkerOut } from '../color/analyze.worker'
import { commitHistory, newHistory, redoHistory, undoHistory, type History } from './history'

export type AppMode = 'studio' | 'test' | 'validate'

/** frames que se pueden cargar a la vez */
export const MAX_FRAMES = 6

export interface TestLayer {
  id: string
  name: string
  lut: Lut
  enabled: boolean
  /** 0..1 */
  opacity: number
}

/** Un frame cargado. Todos ven el mismo LUT; el principal es el que se edita en grande. */
export interface Frame {
  id: string
  /** etiqueta editable ("piel", "cielo", "noche") */
  label: string
  image: FloatImage
}

export interface NamedLut {
  name: string
  lut: Lut
}

export type ValidateView = 'expected' | 'still' | 'diff'

export interface ValidationState {
  /** qué LUT se compara: el actual del Estudio (horneado en GPU) o un .cube elegido */
  lutChoice: 'studio' | 'file'
  fileLut: NamedLut | null
  still: FloatImage | null
  expected: FloatImage | null
  stats: CompareStats | null
  /** nombre del LUT con el que se calculó `stats` */
  comparedWith: string | null
  view: ValidateView
  amplify: number
}

/** Overlays y umbrales de las alertas del LUT (solo pantalla: nada de esto entra al .cube). */
export interface AlertSettings {
  clip: boolean
  breaks: boolean
  inversions: boolean
  breakK: number
  inversionTol: number
}

export type Diagnostics = WorkerOut

export interface Notice {
  id: number
  kind: 'info' | 'warn' | 'error'
  text: string
}

interface AppState {
  mode: AppMode
  frames: Frame[]
  activeFrame: string | null
  /** imagen del frame principal (derivada de frames y activeFrame) */
  image: FloatImage | null
  /** vista grilla con todos los frames */
  gridView: boolean
  /** scopes con todos los frames combinados en lugar del principal */
  scopesAllFrames: boolean
  /** incluir los píxeles de los frames en el JSON al guardar el proyecto */
  embedFrames: boolean
  /** frames que pide el proyecto abierto y todavía no se cargaron */
  missingFrames: FrameRef[]
  interpolation: Interpolation
  display: DisplayTransform
  compare: CompareMode
  split: number
  testLayers: TestLayer[]
  /** parámetros del look (modo Estudio) */
  params: LookParams
  conversionLut: NamedLut | null
  creativeLut: NamedLut | null
  lutSize: LutSize
  history: History
  /** LUTs que pide el proyecto abierto y todavía no se cargaron */
  missingLuts: { conversion: LutRef | null; creative: LutRef | null }
  /** incluir los LUTs dentro del JSON al guardar el proyecto */
  embedLuts: boolean
  scopeMode: ScopeMode | 'off'
  alerts: AlertSettings
  diagnostics: Diagnostics | null
  diagBusy: boolean
  validation: ValidationState
  notices: Notice[]
  gpuError: string | null
  busy: string | null
  /** contadores para pedirle acciones al viewer */
  fitNonce: number
  oneToOneNonce: number

  setMode: (m: AppMode) => void
  /** agrega frames (hasta MAX_FRAMES); el primero agregado pasa a ser el principal. Devuelve cuántos entraron. */
  addFrames: (items: { image: FloatImage; label?: string }[]) => number
  /** reemplaza todos los frames (al abrir un proyecto) */
  replaceFrames: (items: { image: FloatImage; label: string }[], active: number) => void
  setActiveFrame: (id: string) => void
  setFrameLabel: (id: string, label: string) => void
  removeFrame: (id: string) => void
  setGridView: (v: boolean) => void
  setScopesAllFrames: (v: boolean) => void
  setEmbedFrames: (v: boolean) => void
  setMissingFrames: (refs: FrameRef[]) => void
  setInterpolation: (i: Interpolation) => void
  setDisplay: (d: DisplayTransform) => void
  setCompare: (c: CompareMode) => void
  setSplit: (s: number) => void
  /** modifica los parámetros del look con una función que muta una copia */
  updateParams: (fn: (p: LookParams) => void) => void
  resetParams: () => void
  /** marca el fin de un cambio (punto del historial de deshacer) */
  commit: () => void
  undo: () => void
  redo: () => void
  /** reemplaza los parámetros (al abrir un proyecto) y reinicia el historial */
  loadState: (s: Partial<Pick<AppState, 'params' | 'lutSize' | 'interpolation' | 'conversionLut' | 'creativeLut' | 'missingLuts'>>) => void
  setEmbedLuts: (v: boolean) => void
  setScopeMode: (m: ScopeMode | 'off') => void
  setAlerts: (patch: Partial<AlertSettings>) => void
  setDiagnostics: (d: Diagnostics | null) => void
  setDiagBusy: (b: boolean) => void
  updateValidation: (patch: Partial<ValidationState>) => void
  setConversionLut: (l: NamedLut | null) => void
  setCreativeLut: (l: NamedLut | null) => void
  setLutSize: (n: LutSize) => void
  addTestLayer: (name: string, lut: Lut) => void
  updateTestLayer: (id: string, patch: Partial<Pick<TestLayer, 'enabled' | 'opacity'>>) => void
  moveTestLayer: (id: string, dir: -1 | 1) => void
  removeTestLayer: (id: string) => void
  clearTestLayers: () => void
  notify: (kind: Notice['kind'], text: string) => void
  dismissNotice: (id: number) => void
  setGpuError: (e: string | null) => void
  setBusy: (b: string | null) => void
  requestFit: () => void
  requestOneToOne: () => void
}

let seq = 1

const activeImage = (frames: Frame[], id: string | null) => frames.find((f) => f.id === id)?.image ?? null

let autoCommit: ReturnType<typeof setTimeout> | undefined
/** los cambios que no llaman a commit (toggles, selects) se registran solos después de una pausa */
const AUTO_COMMIT_MS = 600

export const useApp = create<AppState>((set, get) => ({
  mode: 'studio',
  frames: [],
  activeFrame: null,
  image: null,
  gridView: false,
  scopesAllFrames: false,
  embedFrames: false,
  missingFrames: [],
  interpolation: 'tetrahedral',
  display: 'rec709-srgb',
  compare: 'off',
  split: 0.5,
  testLayers: [],
  params: defaultParams(),
  conversionLut: null,
  creativeLut: null,
  lutSize: 33,
  history: newHistory(defaultParams()),
  missingLuts: { conversion: null, creative: null },
  embedLuts: false,
  scopeMode: 'waveform',
  alerts: {
    clip: false,
    breaks: false,
    inversions: false,
    breakK: DEFAULT_ANALYZE.breakK,
    inversionTol: DEFAULT_ANALYZE.inversionTol,
  },
  diagnostics: null,
  diagBusy: false,
  validation: {
    lutChoice: 'studio',
    fileLut: null,
    still: null,
    expected: null,
    stats: null,
    comparedWith: null,
    view: 'diff',
    amplify: 100,
  },
  notices: [],
  gpuError: null,
  busy: null,
  fitNonce: 0,
  oneToOneNonce: 0,

  setMode: (mode) => set({ mode }),
  addFrames: (items) => {
    const s = get()
    const room = Math.max(0, MAX_FRAMES - s.frames.length)
    const added = items.slice(0, room).map((it) => ({ id: `f${seq++}`, label: it.label ?? '', image: it.image }))
    if (!added.length) return 0
    const frames = [...s.frames, ...added]
    set({ frames, activeFrame: added[0].id, image: added[0].image })
    return added.length
  },
  replaceFrames: (items, active) => {
    const frames = items.slice(0, MAX_FRAMES).map((it) => ({ id: `f${seq++}`, label: it.label, image: it.image }))
    const id = frames[Math.min(active, frames.length - 1)]?.id ?? null
    set({ frames, activeFrame: id, image: activeImage(frames, id) })
  },
  setActiveFrame: (id) => set((s) => (s.frames.some((f) => f.id === id) ? { activeFrame: id, image: activeImage(s.frames, id) } : s)),
  setFrameLabel: (id, label) => set((s) => ({ frames: s.frames.map((f) => (f.id === id ? { ...f, label } : f)) })),
  removeFrame: (id) =>
    set((s) => {
      const i = s.frames.findIndex((f) => f.id === id)
      if (i < 0) return s
      const frames = s.frames.filter((f) => f.id !== id)
      const activeFrame = s.activeFrame === id ? (frames[Math.min(i, frames.length - 1)]?.id ?? null) : s.activeFrame
      return { frames, activeFrame, image: activeImage(frames, activeFrame) }
    }),
  setGridView: (gridView) => set({ gridView }),
  setScopesAllFrames: (scopesAllFrames) => set({ scopesAllFrames }),
  setEmbedFrames: (embedFrames) => set({ embedFrames }),
  setMissingFrames: (missingFrames) => set({ missingFrames }),
  setInterpolation: (interpolation) => set({ interpolation }),
  setDisplay: (display) => set({ display }),
  setCompare: (compare) => set({ compare }),
  setSplit: (split) => set({ split: Math.min(1, Math.max(0, split)) }),
  updateParams: (fn) => {
    set((s) => {
      const params = structuredClone(s.params)
      fn(params)
      return { params }
    })
    clearTimeout(autoCommit)
    autoCommit = setTimeout(() => get().commit(), AUTO_COMMIT_MS)
  },
  resetParams: () => {
    set({ params: defaultParams() })
    get().commit()
  },
  commit: () => {
    clearTimeout(autoCommit)
    set((s) => {
      const history = commitHistory(s.history, s.params)
      return history === s.history ? s : { history }
    })
  },
  undo: () => {
    clearTimeout(autoCommit)
    const s = get()
    const r = undoHistory(s.history, s.params)
    if (r) set({ history: r.h, params: r.params })
  },
  redo: () => {
    clearTimeout(autoCommit)
    const s = get()
    const r = redoHistory(s.history, s.params)
    if (r) set({ history: r.h, params: r.params })
  },
  loadState: (next) => {
    clearTimeout(autoCommit)
    set((s) => ({ ...next, history: newHistory(next.params ?? s.params) }))
  },
  setEmbedLuts: (embedLuts) => set({ embedLuts }),
  setScopeMode: (scopeMode) => set({ scopeMode }),
  setAlerts: (patch) => set((s) => ({ alerts: { ...s.alerts, ...patch } })),
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setDiagBusy: (diagBusy) => set({ diagBusy }),
  updateValidation: (patch) => set((s) => ({ validation: { ...s.validation, ...patch } })),
  setConversionLut: (conversionLut) => set((s) => ({ conversionLut, missingLuts: { ...s.missingLuts, conversion: null } })),
  setCreativeLut: (creativeLut) => set((s) => ({ creativeLut, missingLuts: { ...s.missingLuts, creative: null } })),
  setLutSize: (lutSize) => set({ lutSize }),
  addTestLayer: (name, lut) =>
    set((s) => ({ testLayers: [...s.testLayers, { id: `l${seq++}`, name, lut, enabled: true, opacity: 1 }] })),
  updateTestLayer: (id, patch) =>
    set((s) => ({ testLayers: s.testLayers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
  moveTestLayer: (id, dir) =>
    set((s) => {
      const i = s.testLayers.findIndex((l) => l.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= s.testLayers.length) return s
      const next = s.testLayers.slice()
      ;[next[i], next[j]] = [next[j], next[i]]
      return { testLayers: next }
    }),
  removeTestLayer: (id) => set((s) => ({ testLayers: s.testLayers.filter((l) => l.id !== id) })),
  clearTestLayers: () => set({ testLayers: [] }),
  notify: (kind, text) => set((s) => ({ notices: [...s.notices.slice(-5), { id: seq++, kind, text }] })),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  setGpuError: (gpuError) => set({ gpuError }),
  setBusy: (busy) => set({ busy }),
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
  requestOneToOne: () => set((s) => ({ oneToOneNonce: s.oneToOneNonce + 1 })),
}))
