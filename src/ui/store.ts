import { create } from 'zustand'
import type { Interpolation, Lut } from '../color/lut'
import type { CompareMode, DisplayTransform } from '../gpu/renderer'
import type { FloatImage } from '../io/image'

export type AppMode = 'studio' | 'test' | 'validate'

export interface TestLayer {
  id: string
  name: string
  lut: Lut
  enabled: boolean
  /** 0..1 */
  opacity: number
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

export const useApp = create<AppState>((set) => ({
  mode: 'test',
  image: null,
  interpolation: 'tetrahedral',
  display: 'rec709-srgb',
  compare: 'off',
  split: 0.5,
  testLayers: [],
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
