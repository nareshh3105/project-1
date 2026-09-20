import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { readPersisted, writePersisted, isRecord } from '@/lib/persist'

export type TransitionType = 'cut' | 'fade' | 'slide' | 'wipe'

const STORAGE_KEY = 'cb:transition'

interface Persisted { type: TransitionType; durationMs: number }

const TRANSITION_TYPES: readonly TransitionType[] = ['cut', 'fade', 'slide', 'wipe']

const DEFAULTS: Persisted = { type: 'fade', durationMs: 300 }

// An unknown type reaches CSS as `animation-name: program-undefined` and a
// non-finite duration as `undefinedms`; the browser drops both and the
// transition silently never plays.
const isPersisted = (v: unknown): v is Persisted =>
  isRecord(v) &&
  TRANSITION_TYPES.includes(v.type as TransitionType) &&
  typeof v.durationMs === 'number' &&
  Number.isFinite(v.durationMs) &&
  v.durationMs > 0

function load(): Persisted {
  return readPersisted(STORAGE_KEY, isPersisted, () => ({ ...DEFAULTS }))
}

function persist(type: TransitionType, durationMs: number) {
  writePersisted(STORAGE_KEY, { type, durationMs })
}

interface TransitionState {
  type:            TransitionType
  durationMs:      number
  isTransitioning: boolean
}

interface TransitionActions {
  setType:           (type: TransitionType) => void
  setDuration:       (ms: number) => void
  executeTransition: (onSwap: () => void) => void
}

export const useTransitionStore = create<TransitionState & TransitionActions>()(
  immer((set, get) => ({
    ...load(),
    isTransitioning: false,

    setType: (type) => set((s) => {
      s.type = type
      persist(type, s.durationMs)
    }),

    setDuration: (ms) => set((s) => {
      s.durationMs = ms
      persist(s.type, ms)
    }),

    executeTransition: (onSwap) => {
      const { type, durationMs, isTransitioning } = get()
      if (isTransitioning) return

      if (type === 'cut') {
        onSwap()
        return
      }

      set((s) => { s.isTransitioning = true })
      // Swap at midpoint so animation shows outgoing then incoming
      setTimeout(() => {
        onSwap()
        setTimeout(() => {
          set((s) => { s.isTransitioning = false })
        }, durationMs / 2)
      }, durationMs / 2)
    },
  }))
)
