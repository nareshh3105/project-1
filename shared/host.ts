/**
 * The conversation between the main process, the interface window and the
 * output host window.
 *
 * Recording, streaming, the replay buffer and the virtual camera are all fed by
 * the output host: a separate window that composes the scene, mixes the audio
 * and encodes it. It has to be a separate window because Web Audio runs at
 * about 72% of real time in a window that is minimized or hidden (measured in
 * docs/spikes/output-pipeline.md), and the interface window must be free to be
 * minimized while a recording runs. The host is kept visible but parked
 * off-screen, where the clock stays at real time.
 *
 * Dependency-free: it is imported by the main process, the preload script and
 * the renderer, which do not share a type environment.
 */

export const HOST_CHANNELS = {
  /** host -> main: the host page has loaded and can take requests. */
  ready: 'cb:host-ready',
  /** main -> host: do something and reply. */
  request: 'cb:host-request',
  /** host -> main: the reply to a request. */
  response: 'cb:host-response',
  /** main -> host: the latest scene and mixer snapshot. */
  state: 'cb:host-state',
  /** host -> main: a chunk of encoded output for a session. */
  ingest: 'cb:ingest',
  /** host -> main: something happened that nobody asked about. */
  event: 'cb:host-event',
} as const

export type HostChannel = (typeof HOST_CHANNELS)[keyof typeof HOST_CHANNELS]

/** Channels the host and interface may send on, and receive on. Anything else is refused. */
export const SEND_CHANNELS: readonly string[] = [
  HOST_CHANNELS.ready, HOST_CHANNELS.response, HOST_CHANNELS.ingest, HOST_CHANNELS.event,
]
export const RECEIVE_CHANNELS: readonly string[] = [
  HOST_CHANNELS.request, HOST_CHANNELS.state,
]

// ── Sessions ───────────────────────────────────────────────────────────────

export type OutputKind = 'recording' | 'streaming' | 'replay' | 'virtualCamera'

/** Which H.264 encoder to ask for. `auto` tries hardware and falls back to software. */
export type EncoderPreference = 'auto' | 'hardware' | 'software'

export interface SessionParams {
  width: number
  height: number
  fps: number
  /** bits per second */
  videoBitrate: number
  /** bits per second */
  audioBitrate: number
  encoder: EncoderPreference
  /** Seconds between keyframes. Streaming services expect 2. */
  keyframeSeconds: number
  /** False for outputs that carry no sound (the virtual camera). */
  audio: boolean
}

export type HostMethod = 'openSession' | 'closeSession' | 'ping'

export interface HostRequest {
  id: number
  method: HostMethod
  args: unknown
}

export interface HostResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

/** Something the host reports unprompted. */
export type HostEvent =
  | { type: 'sessionError'; kind: OutputKind; message: string }
  | { type: 'stats'; kind: OutputKind; framesIn: number; framesDropped: number; encodeQueue: number; bytesOut: number }

// ── What the host needs to know to compose and mix ─────────────────────────

export interface SnapshotTransform {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scaleX: number
  scaleY: number
}

/** A filter on a source, as the host applies it. Ranges are enforced by the main process. */
export type SnapshotFilter =
  | { id: string; type: 'color-correction'; brightness: number; contrast: number; saturation: number; hue: number; opacity: number }
  | { id: string; type: 'crop'; left: number; right: number; top: number; bottom: number }
  | { id: string; type: 'chroma-key'; keyColor: string; similarity: number; smoothness: number; opacity: number }
  | { id: string; type: 'blur'; radius: number }
  | { id: string; type: 'sharpen'; strength: number }

export interface SnapshotSource {
  id: string
  /** What it is: only the capture types draw anything. */
  type: string
  /** Bottom of the stack first. */
  order: number
  transform: SnapshotTransform
  /** What it captures, or null if it has not been set up. */
  target: { kind: 'screen' | 'window' | 'camera'; id: string; name: string } | null
  /**
   * Settings for sources drawn from their settings alone (color, text, image).
   * Plain values only; the main process drops anything else.
   */
  settings: Record<string, string | number | boolean>
  /** Enabled filters, in the order they apply. */
  filters: SnapshotFilter[]
}

export interface SnapshotChannel {
  id: string
  volume: number
  muted: boolean
  noiseSuppression: boolean
  /** Whether the interface has a real input attached to this channel. */
  connected: boolean
  /** The device chosen for this channel; empty for the system default. */
  deviceId: string
}

/** A scene change in progress: the new scene is `sources`, the one it replaces is `from`. */
export interface SnapshotTransition {
  type: 'fade' | 'slide' | 'wipe'
  durationMs: number
  /** Milliseconds since the epoch (Date.now), so any window can work out how far along it is. */
  startedAt: number
  from: SnapshotSource[]
}

export interface HostSnapshot {
  /** The canvas sources are positioned on. */
  base: { width: number; height: number }
  /** Visible sources of the scene being output, bottom first. */
  sources: SnapshotSource[]
  audio: SnapshotChannel[]
  /** Present only while a transition is under way. */
  transition?: SnapshotTransition
}

export const EMPTY_SNAPSHOT: HostSnapshot = {
  base: { width: 1920, height: 1080 },
  sources: [],
  audio: [],
}
