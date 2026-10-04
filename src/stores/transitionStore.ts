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

/** A scene change that is playing: what is being replaced, by what, and when it began. */
export interface ActiveTransition {
  fromSceneId: string | null
  toSceneId:   string
  type:        Exclude<TransitionType, 'cut'>
  durationMs:  number
  /** Milliseconds since the epoch, so the output window can tell how far along it is. */
  startedAt:   number
}

interface TransitionState {
  type:            TransitionType
  durationMs:      number
  isTransitioning: boolean
  active:          ActiveTransition | null
}

interface TransitionActions {
  setType:           (type: TransitionType) => void
  setDuration:       (ms: number) => void
  /**
   * Changes scene with the chosen transition. The change happens at once; the
   * old scene stays drawn underneath while the new one comes in over it.
   */
  executeTransition: (scenes: { fromSceneId: string | null; toSceneId: string }, onSwap: () => void) => void
}

export const useTransitionStore = create<TransitionState & TransitionActions>()(
  immer((set, get) => ({
    ...load(),
    isTransitioning: false,
    active:          null,

    setType: (type) => set((s) => {
      s.type = type
      persist(type, s.durationMs)
    }),

    setDuration: (ms) => set((s) => {
      s.durationMs = ms
      persist(s.type, ms)
    }),

    executeTransition: ({ fromSceneId, toSceneId }, onSwap) => {
      const { type, durationMs, isTransitioning } = get()
      if (isTransitioning) return

      if (type === 'cut') {
        onSwap()
        return
      }

      const startedAt = Date.now()
      set((s) => {
        s.isTransitioning = true
        s.active = { fromSceneId, toSceneId, type, durationMs, startedAt }
      })
      onSwap()

      setTimeout(() => {
        set((s) => {
          // Only the transition that started this timer: a later one has its own.
          if (s.active?.startedAt === startedAt) { s.isTransitioning = false; s.active = null }
        })
      }, durationMs)
    },
  }))
)
