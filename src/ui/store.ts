import { create } from 'zustand'
import type { Interpolation, Lut } from '../color/lut'
import { defaultParams, type LookParams, type LutSize } from '../color/params'
import type { CompareMode, DisplayTransform } from '../gpu/renderer'
import type { ScopeMode } from '../gpu/scopes'
import type { FloatImage } from '../io/image'
import type { LutRef } from '../io/project'
import { commitHistory, newHistory, redoHistory, undoHistory, type History } from './history'

export type AppMode = 'studio' | 'test' | 'validate'

export interface TestLayer {
  id: string
  name: string
  lut: Lut
  enabled: boolean
  /** 0..1 */
  opacity: number
}

export interface NamedLut {
  name: string
  lut: Lut
}

export interface Notice {
  id: number
  kind: 'info' | 'warn' | 'error'
  text: string
}

interface AppState {
  mode: AppMode
  image: FloatImage | null
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
  notices: Notice[]
  gpuError: string | null
  busy: string | null
  /** contadores para pedirle acciones al viewer */
  fitNonce: number
  oneToOneNonce: number

  setMode: (m: AppMode) => void
  setImage: (img: FloatImage | null) => void
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

let autoCommit: ReturnType<typeof setTimeout> | undefined
/** los cambios que no llaman a commit (toggles, selects) se registran solos después de una pausa */
const AUTO_COMMIT_MS = 600

export const useApp = create<AppState>((set, get) => ({
  mode: 'studio',
  image: null,
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
  notices: [],
  gpuError: null,
  busy: null,
  fitNonce: 0,
  oneToOneNonce: 0,

  setMode: (mode) => set({ mode }),
  setImage: (image) => set({ image }),
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
