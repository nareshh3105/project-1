import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type TransitionType = 'cut' | 'fade' | 'slide' | 'wipe'

const STORAGE_KEY = 'cb:transition'

interface Persisted { type: TransitionType; durationMs: number }

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { type: 'fade', durationMs: 300 }
}

function persist(type: TransitionType, durationMs: number) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ type, durationMs })) } catch { /* ignore */ }
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
