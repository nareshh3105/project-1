import type { ID, Resolution, FrameRate } from './common'
import type { AudioSettings } from './audio'
import type { OutputSettings } from './output'

export interface Profile {
  id: ID
  name: string
  outputSettings: OutputSettings
  audioSettings: AudioSettings
  createdAt: number
  updatedAt: number
}

export interface GeneralSettings {
  theme: 'dark'                   // Only dark theme in Phase 1
  language: string                // BCP-47 locale
  systemTray: boolean
  confirmOnExit: boolean
  updateChannel: 'stable' | 'beta'
  autoCheckUpdates: boolean
  statsUpdateInterval: number     // ms
}

export interface VideoSettings {
  baseResolution: Resolution
  outputResolution: Resolution
  fps: FrameRate
  fpsNumerator: number
  fpsDenominator: number
  downscaleFilter: 'bilinear' | 'area' | 'bicubic' | 'lanczos'
  colorFormat: 'NV12' | 'I420' | 'I444' | 'RGB' | 'BGR3'
  colorSpace: '601' | '709' | '2020'
  colorRange: 'partial' | 'full'
  gpuConversion: boolean
}

export interface AdvancedSettings {
  processId: number
  renderer: 'auto' | 'd3d11' | 'opengl'
  adapterIndex: number
  multiThreadedVideo: boolean
  disableOSXVsync: boolean
  resetOSXVsync: boolean
  audioMonitoringDevice: string
  delayEnable: boolean
  delaySec: number
  reconnectEnable: boolean
  reconnectRetryDelay: number
  reconnectMaxRetries: number
  filenameFormatting: string      // strftime-style template
  overwriteIfExists: boolean
  replayBufferFilenamePrefix: string
  replayBufferFilenamePostfix: string
  virtualCameraOutputType: 'program' | 'preview'
  virtualCameraSource: string | null
}

export interface AppSettings {
  general: GeneralSettings
  video: VideoSettings
  audio: AudioSettings
  advanced: AdvancedSettings
  activeProfileId: ID | null
  activeSceneCollectionId: ID | null
}
