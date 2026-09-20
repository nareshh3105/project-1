import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

const STREAM_KEY = 'cb:stream'

export interface StreamSettings {
  rtmpUrl:   string
  streamKey: string
}

const EMPTY_STREAM: StreamSettings = { rtmpUrl: '', streamKey: '' }

/**
 * Reads persisted stream settings, coercing each field independently. A
 * half-written or hand-edited entry used to come back with an undefined
 * field, which turned the modal's inputs uncontrolled and made
 * `streamKey.trim()` throw on Go Live.
 */
function loadStream(): StreamSettings {
  try {
    const raw = localStorage.getItem(STREAM_KEY)
    if (!raw) return { ...EMPTY_STREAM }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_STREAM }
    const { rtmpUrl, streamKey } = parsed as Partial<StreamSettings>
    return {
      rtmpUrl:   typeof rtmpUrl   === 'string' ? rtmpUrl   : '',
      streamKey: typeof streamKey === 'string' ? streamKey : '',
    }
  } catch {
    return { ...EMPTY_STREAM }
  }
}

function saveStream(s: StreamSettings) {
  try { localStorage.setItem(STREAM_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

export interface OutputState {
  recording: {
    active:    boolean
    filePath:  string | null
    startedAt: number | null
    elapsed:   number     // seconds
  }
  streaming: {
    active:    boolean
    startedAt: number | null
    elapsed:   number
  }
  replayBuffer: {
    active: boolean
  }
  virtualCamera: {
    active: boolean
    url:    string | null
  }
  stream:          StreamSettings
  ffmpegAvailable: boolean | null  // null = unchecked
}

interface OutputActions {
  setRecordingStatus:  (active: boolean, filePath: string | null) => void
  setStreamingStatus:  (active: boolean) => void
  setReplayActive:          (active: boolean) => void
  setVirtualCameraStatus:   (active: boolean, url: string | null) => void
  tickElapsed:         () => void
  setFfmpegAvailable:  (v: boolean) => void
  setStreamSettings:   (rtmpUrl: string, streamKey: string) => void
}

export const useOutputStore = create<OutputState & OutputActions>()(
  immer((set) => ({
    recording:       { active: false, filePath: null, startedAt: null, elapsed: 0 },
    streaming:       { active: false, startedAt: null, elapsed: 0 },
    replayBuffer:    { active: false },
    virtualCamera:   { active: false, url: null },
    stream:          loadStream(),
    ffmpegAvailable: null,

    setRecordingStatus: (active, filePath) => set((s) => {
      s.recording.active    = active
      s.recording.filePath  = filePath
      s.recording.startedAt = active ? Date.now() : null
      s.recording.elapsed   = 0
    }),

    setStreamingStatus: (active) => set((s) => {
      s.streaming.active    = active
      s.streaming.startedAt = active ? Date.now() : null
      s.streaming.elapsed   = 0
    }),

    setReplayActive: (active) => set((s) => { s.replayBuffer.active = active }),

    setVirtualCameraStatus: (active, url) => set((s) => {
      s.virtualCamera.active = active
      s.virtualCamera.url    = url
    }),

    tickElapsed: () => set((s) => {
      if (s.recording.active && s.recording.startedAt) {
        s.recording.elapsed = Math.floor((Date.now() - s.recording.startedAt) / 1000)
      }
      if (s.streaming.active && s.streaming.startedAt) {
        s.streaming.elapsed = Math.floor((Date.now() - s.streaming.startedAt) / 1000)
      }
    }),

    setFfmpegAvailable: (v) => set((s) => { s.ffmpegAvailable = v }),

    setStreamSettings: (rtmpUrl, streamKey) => set((s) => {
      s.stream.rtmpUrl   = rtmpUrl
      s.stream.streamKey = streamKey
      saveStream({ rtmpUrl, streamKey })
    }),
  }))
)
