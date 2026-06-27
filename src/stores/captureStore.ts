import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { SourceType } from '@/types'

export const CAPTURE_SOURCE_TYPES: SourceType[] = [
  'display_capture', 'window_capture', 'game_capture', 'dshow_video',
]

export function isCaptureType(type: SourceType): boolean {
  return CAPTURE_SOURCE_TYPES.includes(type)
}

// Module-level — MediaStream is not JSON-serializable, must live outside Zustand
const _streams = new Map<string, MediaStream>()

interface CaptureState {
  activeIds: string[]
  errors:    Record<string, string>
}

interface CaptureActions {
  startCapture: (sourceId: string, type: SourceType) => Promise<void>
  stopCapture:  (sourceId: string) => void
  stopAll:      () => void
  getStream:    (sourceId: string) => MediaStream | undefined
}

export const useCaptureStore = create<CaptureState & CaptureActions>()(
  immer((set) => ({
    activeIds: [],
    errors:    {},

    startCapture: async (sourceId, type) => {
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

      try {
        let stream: MediaStream

        if (type === 'dshow_video') {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        } else {
          // display_capture, window_capture, game_capture — uses the OS screen picker
          stream = await (navigator.mediaDevices as MediaDevices).getDisplayMedia({
            video: { frameRate: 30 } as MediaTrackConstraints,
            audio: false,
          })
        }

        // Detect when user clicks "Stop sharing" in the browser toolbar
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener('ended', () => {
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
        const msg = err instanceof Error ? err.message : 'Capture failed or was cancelled'
        set((s) => { s.errors[sourceId] = msg })
      }
    },

    stopCapture: (sourceId) => {
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
      _streams.forEach((stream) => stream.getTracks().forEach((t) => t.stop()))
      _streams.clear()
      set((s) => { s.activeIds = []; s.errors = {} })
    },

    getStream: (sourceId) => _streams.get(sourceId),
  }))
)
