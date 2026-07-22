import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

const STREAM_KEY = 'cb:stream'

export interface StreamSettings {
  rtmpUrl:   string
  streamKey: string
}

function loadStream(): StreamSettings {
  try {
    const raw = localStorage.getItem(STREAM_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { rtmpUrl: '', streamKey: '' }
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
