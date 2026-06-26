import type { ID, Resolution, FrameRate } from './common'

// ── Stream ───────────────────────────────────────────────────────────────

export type StreamServiceType = 'rtmp_custom' | 'twitch' | 'youtube' | 'facebook' | 'kick'

export interface StreamService {
  type: StreamServiceType
  name: string
  server: string      // RTMP URL
  key: string         // Stream key (stored encrypted)
}

export type StreamState =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'disconnecting'
  | 'error'

export interface StreamStatus {
  state: StreamState
  durationMs: number
  droppedFrames: number
  totalFrames: number
  bitrateBps: number   // current measured bitrate
  error: string | null
}

// ── Recording ─────────────────────────────────────────────────────────────

export type RecordingFormat = 'mkv' | 'mp4' | 'mov' | 'ts' | 'fragmented_mp4'

export type RecordingState =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'error'

export interface RecordingStatus {
  state: RecordingState
  durationMs: number
  filePath: string | null
  sizeMb: number
  error: string | null
}

// ── Virtual Camera ────────────────────────────────────────────────────────

export interface VirtualCameraStatus {
  active: boolean
  outputResolution: Resolution | null
}

// ── Replay Buffer ─────────────────────────────────────────────────────────

export interface ReplayBufferStatus {
  active: boolean
  durationSec: number
}

// ── Encoder settings ──────────────────────────────────────────────────────

export type VideoEncoder =
  | 'obs_x264'
  | 'obs_qsv11'
  | 'jim_nvenc'
  | 'h265_nvenc'
  | 'amd_amf_h264'
  | 'apple_videotoolbox_h264'

export type AudioEncoder = 'ffmpeg_aac' | 'mf_aac' | 'opus' | 'mp3'

export interface VideoEncoderSettings {
  encoder: VideoEncoder
  bitrate: number         // kbps
  rateControl: 'CBR' | 'VBR' | 'CQP'
  keyframeInterval: number
  preset: string          // e.g. 'veryfast', 'medium'
  profile: 'baseline' | 'main' | 'high'
  bFrames: number
}

export interface AudioEncoderSettings {
  encoder: AudioEncoder
  bitrate: 96 | 128 | 160 | 192 | 256 | 320   // kbps
  sampleRate: 44100 | 48000
  channels: 1 | 2
}

// ── Combined output settings ───────────────────────────────────────────────

export interface OutputSettings {
  id: ID
  name: string
  baseResolution: Resolution
  outputResolution: Resolution
  fps: FrameRate
  fpsNumerator: number     // for fractional FPS (e.g. 30000/1001)
  fpsDenominator: number
  downscaleFilter: 'bilinear' | 'area' | 'bicubic' | 'lanczos'
  videoEncoder: VideoEncoderSettings
  audioEncoder: AudioEncoderSettings
  recordingPath: string
  recordingFormat: RecordingFormat
  replayBufferSeconds: number
  streamService: StreamService | null
}
