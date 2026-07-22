import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export interface ChannelLevels {
  peakL: number   // dBFS, -100 = silence
  peakR: number
  rmsL:  number
  rmsR:  number
}

export interface AudioChannel {
  id:               string
  name:             string
  volume:           number   // 0.0 – 1.0
  muted:            boolean
  noiseSuppression: boolean
  levels:           ChannelLevels
}

const CHANNEL_DEFS: { id: string; name: string }[] = [
  { id: 'desktop', name: 'Desktop' },
  { id: 'mic',     name: 'Mic/Aux' },
  { id: 'browser', name: 'Browser' },
  { id: 'music',   name: 'Music'   },
]

function silentLevels(): ChannelLevels {
  return { peakL: -100, peakR: -100, rmsL: -100, rmsR: -100 }
}

function makeChannel(id: string, name: string): AudioChannel {
  return { id, name, volume: 1, muted: false, noiseSuppression: false, levels: silentLevels() }
}

interface AudioState {
  channels: AudioChannel[]
}

interface AudioActions {
  setVolume:           (id: string, volume: number) => void
  setMuted:            (id: string, muted: boolean) => void
  setNoiseSuppression: (id: string, enabled: boolean) => void
  updateLevels:        (id: string, levels: ChannelLevels) => void
}

export const useAudioStore = create<AudioState & AudioActions>()(
  immer((set) => ({
    channels: CHANNEL_DEFS.map(({ id, name }) => makeChannel(id, name)),

    setVolume: (id, volume) =>
      set((s) => {
        const ch = s.channels.find((c) => c.id === id)
        if (ch) ch.volume = volume
      }),

    setMuted: (id, muted) =>
      set((s) => {
        const ch = s.channels.find((c) => c.id === id)
        if (ch) ch.muted = muted
      }),

    setNoiseSuppression: (id, enabled) =>
      set((s) => {
        const ch = s.channels.find((c) => c.id === id)
        if (ch) ch.noiseSuppression = enabled
      }),

    updateLevels: (id, levels) =>
      set((s) => {
        const ch = s.channels.find((c) => c.id === id)
        if (ch) ch.levels = levels
      }),
  }))
)
