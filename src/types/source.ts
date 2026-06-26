import type { ID, Timestamp, Transform } from './common'

// ── Source type catalogue ────────────────────────────────────────────────

export type SourceType =
  | 'display_capture'     // Full monitor
  | 'window_capture'      // Specific application window
  | 'game_capture'        // DirectX/Vulkan game hook
  | 'dshow_video'         // DirectShow webcam / capture card
  | 'wasapi_output'       // Desktop audio loopback
  | 'wasapi_input'        // Microphone
  | 'image'               // Static image (PNG/JPG/GIF)
  | 'image_slideshow'     // Rotating images
  | 'media_source'        // Video/audio file or URL stream
  | 'browser_source'      // CEF browser / overlay
  | 'color_source'        // Solid colour fill
  | 'text_gdi_plus'       // Text (GDI+, Windows only)
  | 'vlc_source'          // VLC playlist
  | 'ndi_source'          // NDI network video
  | 'scene'               // Nested scene

// ── Per-type settings payloads ───────────────────────────────────────────

export interface DisplayCaptureSettings {
  monitorIndex: number
  captureCursor: boolean
  captureSdr: boolean
}

export interface WindowCaptureSettings {
  windowTitle: string
  captureCursor: boolean
  clientArea: boolean
}

export interface WebcamSettings {
  deviceId: string
  width: number
  height: number
  fps: number
}

export interface BrowserSourceSettings {
  url: string
  width: number
  height: number
  fps: number
  css: string
  restartOnActivate: boolean
}

export interface ImageSettings {
  filePath: string
  unload: boolean
}

export interface MediaSourceSettings {
  localFile: boolean
  filePath: string
  loop: boolean
  restartOnActivate: boolean
  speedPercent: number
}

export interface ColorSourceSettings {
  color: string   // hex
  width: number
  height: number
}

export interface TextSettings {
  text: string
  fontFamily: string
  fontSize: number
  bold: boolean
  italic: boolean
  color: string
  backgroundColor: string
  outline: boolean
  scrolling: boolean
  scrollSpeed: number
}

export type SourceSettings =
  | DisplayCaptureSettings
  | WindowCaptureSettings
  | WebcamSettings
  | BrowserSourceSettings
  | ImageSettings
  | MediaSourceSettings
  | ColorSourceSettings
  | TextSettings
  | Record<string, unknown>  // fallback for plugin sources

// ── Filter ───────────────────────────────────────────────────────────────

export type FilterType =
  | 'color_correction'
  | 'crop_pad'
  | 'sharpen'
  | 'blur'
  | 'chroma_key'
  | 'luma_key'
  | 'color_key'
  | 'noise_suppression'
  | 'gain'
  | 'compressor'
  | 'limiter'
  | 'expander'

export interface SourceFilter {
  id: ID
  name: string
  type: FilterType
  enabled: boolean
  settings: Record<string, unknown>
  order: number
}

// ── Source instance (placed in a scene) ─────────────────────────────────

export interface SourceInstance {
  id: ID
  sourceId: ID
  name: string
  type: SourceType
  settings: SourceSettings
  transform: Transform
  visible: boolean
  locked: boolean
  muted: boolean             // audio mute, only applies when source has audio
  volume: number             // 0–1 linear
  filters: SourceFilter[]
  groupId: ID | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ── Source definition (shared across scenes) ─────────────────────────────

export interface SourceDefinition {
  id: ID
  name: string
  type: SourceType
  settings: SourceSettings
  audioMonitoring: 'none' | 'monitor_only' | 'monitor_and_output'
  syncOffsetMs: number
  filters: SourceFilter[]
  createdAt: Timestamp
  updatedAt: Timestamp
}
