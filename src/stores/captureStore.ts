import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { SourceType } from '@/types'
import type { CaptureTarget } from '@/lib/capture/target'
import { openCaptureStream } from '@/lib/capture/open'

export const CAPTURE_SOURCE_TYPES: SourceType[] = [
  'display_capture', 'window_capture', 'game_capture', 'dshow_video',
]

export function isCaptureType(type: SourceType): boolean {
  return CAPTURE_SOURCE_TYPES.includes(type)
}

// Module-level — MediaStream is not JSON-serializable, must live outside Zustand
const _streams = new Map<string, MediaStream>()

/**
 * Which start of a source's capture is the current one. Opening a camera or a
 * screen takes a moment, and the source can be removed (or started again) before
 * it finishes. A stream that arrives for a start that is no longer current has
 * nobody to stop it, so it is stopped on arrival; before this, such a stream
 * was kept running with its camera light on and no source left to turn it off.
 */
const _starts = new Map<string, number>()
let _everything = 0

const supersede = (sourceId: string) => { _starts.set(sourceId, (_starts.get(sourceId) ?? 0) + 1) }

interface CaptureState {
  activeIds: string[]
  errors:    Record<string, string>
}

interface CaptureActions {
  /**
   * Starts capturing `target` for a source. Without a target there is nothing
   * to capture, which is reported rather than guessed at.
   */
  startCapture: (sourceId: string, type: SourceType, target: CaptureTarget | null) => Promise<void>
  stopCapture:  (sourceId: string) => void
  stopAll:      () => void
  getStream:    (sourceId: string) => MediaStream | undefined
}

export const useCaptureStore = create<CaptureState & CaptureActions>()(
  immer((set) => ({
    activeIds: [],
    errors:    {},

    startCapture: async (sourceId, _type, target) => {
      supersede(sourceId)
      const start = _starts.get(sourceId)
      const epoch = _everything

      // Clean up any existing stream for this source
      const existing = _streams.get(sourceId)
      if (existing) {
        existing.getTracks().forEach((t) => t.stop())
        _streams.delete(sourceId)
        set((s) => {
          s.activeIds = s.activeIds.filter((id) => id !== sourceId)
          delete s.errors[sourceId]
        })
      }

      if (!target) {
        set((s) => { s.errors[sourceId] = 'Choose what to capture.' })
        return
      }

      try {
        const stream = await openCaptureStream(target)

        // The source was removed, or started again, while this was opening.
        if (_starts.get(sourceId) !== start || _everything !== epoch) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        // Detect when the user clicks "Stop sharing", or the window closes.
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener('ended', () => {
            // Only if this is still the source's stream, not one that replaced it.
            if (_streams.get(sourceId) !== stream) return
            _streams.delete(sourceId)
            set((s) => { s.activeIds = s.activeIds.filter((id) => id !== sourceId) })
          })
        })

        _streams.set(sourceId, stream)
        set((s) => {
          if (!s.activeIds.includes(sourceId)) s.activeIds.push(sourceId)
          delete s.errors[sourceId]
        })
      } catch (err) {
        // A failure of a start that has been replaced says nothing about the current one.
        if (_starts.get(sourceId) !== start || _everything !== epoch) return
        const msg = err instanceof Error && err.message ? err.message : 'Capture failed or was cancelled'
        set((s) => { s.errors[sourceId] = msg })
      }
    },

    stopCapture: (sourceId) => {
      supersede(sourceId) // anything still opening for this source is stopped when it arrives
      const stream = _streams.get(sourceId)
      if (stream) {
        stream.getTracks().forEach((t) => t.stop())
        _streams.delete(sourceId)
      }
      set((s) => {
        s.activeIds = s.activeIds.filter((id) => id !== sourceId)
        delete s.errors[sourceId]
      })
    },

    stopAll: () => {
      _everything++
      _streams.forEach((stream) => stream.getTracks().forEach((t) => t.stop()))
      _streams.clear()
      set((s) => { s.activeIds = []; s.errors = {} })
    },

    getStream: (sourceId) => _streams.get(sourceId),
  }))
)
