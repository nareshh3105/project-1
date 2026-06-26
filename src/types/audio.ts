import type { ID } from './common'

// dBFS value; null means silence / no signal
export type DBLevel = number | null

export interface AudioTrackLevels {
  peak: [DBLevel, DBLevel]    // [L, R]
  input: [DBLevel, DBLevel]
  magnitude: [DBLevel, DBLevel]
}

export interface MixerChannel {
  id: ID
  sourceId: ID
  name: string
  volume: number           // 0–1 linear
  muted: boolean
  monitoringType: 'none' | 'monitor_only' | 'monitor_and_output'
  syncOffsetMs: number
  levels: AudioTrackLevels
  faderPosition: number    // 0–1 mapped from dB (non-linear scale)
}

export type AudioDevice = {
  id: string
  name: string
  isDefault: boolean
  sampleRate: number
  channels: number
}

export interface AudioSettings {
  sampleRate: 44100 | 48000 | 192000
  channels: 1 | 2
  desktopDevice1: string
  desktopDevice2: string
  auxDevice1: string
  auxDevice2: string
  auxDevice3: string
}

// Volume measurement: dB value at which fader position 1.0 maps to (+0 dB)
// Position 0 = silence, position 1.0 = 0 dBFS (unity)
export const DB_SILENCE = -100
export const DB_UNITY   = 0
export const DB_CLIP    = -6
export const DB_CAUTION = -20
