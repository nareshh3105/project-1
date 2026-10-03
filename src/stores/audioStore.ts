import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { readPersisted, writePersisted, isRecord } from '@/lib/persist'

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

// ── What survives a restart ──
// Fader positions, mutes and which inputs were connected: an installed mixer
// comes back the way it was left, not with every fader at full and no sound.

const MIXER_KEY = 'cb:mixer'

interface RememberedChannel { volume?: unknown; muted?: unknown; noiseSuppression?: unknown }
interface Remembered { channels: Record<string, RememberedChannel>; inputs: string[] }

const isRemembered = (v: unknown): v is Remembered =>
  isRecord(v) && isRecord(v.channels) && Array.isArray(v.inputs)

const remembered = (): Remembered =>
  readPersisted(MIXER_KEY, isRemembered, () => ({ channels: {}, inputs: [] }))

function makeChannel(id: string, name: string, saved: RememberedChannel = {}): AudioChannel {
  const volume = typeof saved.volume === 'number' && Number.isFinite(saved.volume)
    ? Math.min(1, Math.max(0, saved.volume)) : 1
  return {
    id, name, volume,
    muted: saved.muted === true,
    noiseSuppression: saved.noiseSuppression === true,
    levels: silentLevels(),
  }
}

/** The inputs the user had connected last time, to be reconnected at launch. */
export const rememberedInputs = (): string[] =>
  remembered().inputs.filter((x): x is string => typeof x === 'string')

/** Records whether the user wants an input connected. */
export function rememberInput(id: string, wanted: boolean): void {
  const saved = remembered()
  const inputs = saved.inputs.filter((x) => x !== id)
  if (wanted) inputs.push(id)
  writePersisted(MIXER_KEY, { ...saved, inputs })
}

function saveChannels(channels: AudioChannel[]): void {
  const saved = remembered()
  writePersisted(MIXER_KEY, {
    ...saved,
    channels: Object.fromEntries(
      channels.map((c) => [c.id, { volume: c.volume, muted: c.muted, noiseSuppression: c.noiseSuppression }]),
    ),
  })
}

interface AudioState {
  channels: AudioChannel[]
  /** Channels with a real input attached. Others read silent by design. */
  connected: string[]
  /** Why a channel could not be connected, keyed by channel id. */
  errors: Record<string, string>
}

interface AudioActions {
  setVolume:           (id: string, volume: number) => void
  setMuted:            (id: string, muted: boolean) => void
  setNoiseSuppression: (id: string, enabled: boolean) => void
  updateLevels:        (id: string, levels: ChannelLevels) => void
  setAllLevels:        (levels: Record<string, ChannelLevels>) => void
  setConnected:        (id: string, connected: boolean) => void
  setChannelError:     (id: string, message: string | null) => void
}

export const useAudioStore = create<AudioState & AudioActions>()(
  immer((set) => ({
    channels: CHANNEL_DEFS.map(({ id, name }) => makeChannel(id, name, remembered().channels[id] as RememberedChannel | undefined)),
    connected: [],
    errors: {},

    setVolume: (id, volume) =>
      set((s) => {
        const ch = s.channels.find((c) => c.id === id)
        if (ch) ch.volume = volume
        saveChannels(s.channels)
      }),

    setMuted: (id, muted) =>
      set((s) => {
        const ch = s.channels.find((c) => c.id === id)
        if (ch) ch.muted = muted
        saveChannels(s.channels)
      }),

    setNoiseSuppression: (id, enabled) =>
      set((s) => {
        const ch = s.channels.find((c) => c.id === id)
        if (ch) ch.noiseSuppression = enabled
        saveChannels(s.channels)
      }),

    updateLevels: (id, levels) =>
      set((s) => {
        const ch = s.channels.find((c) => c.id === id)
        if (ch) ch.levels = levels
      }),

    // One write per frame rather than four. Updating each channel separately
    // pushed four store notifications every animation frame.
    setAllLevels: (levels) =>
      set((s) => {
        for (const ch of s.channels) {
          const next = levels[ch.id]
          if (next) ch.levels = next
        }
      }),

    setConnected: (id, connected) =>
      set((s) => {
        const has = s.connected.includes(id)
        if (connected && !has) s.connected.push(id)
        if (!connected && has) s.connected = s.connected.filter((x) => x !== id)
        if (connected) delete s.errors[id]
      }),

    setChannelError: (id, message) =>
      set((s) => {
        if (message) s.errors[id] = message
        else delete s.errors[id]
      }),
  }))
)
