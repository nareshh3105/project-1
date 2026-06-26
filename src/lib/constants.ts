// Application-wide constants — never import from process.env in components

export const APP_NAME    = 'CodeBuilders'
export const APP_VERSION = '0.1.0'

// IPC event names emitted from Rust → TypeScript
export const IPC_EVENTS = {
  PREVIEW_FRAME:       'preview:frame',
  STREAM_STATUS:       'output:stream-status',
  RECORDING_STATUS:    'output:recording-status',
  REPLAY_STATUS:       'output:replay-status',
  VCAM_STATUS:         'output:vcam-status',
  AUDIO_LEVELS:        'audio:levels',
  SCENE_CHANGED:       'scene:changed',
  SOURCE_UPDATED:      'source:updated',
  STATS_UPDATE:        'stats:update',
  LOG_LINE:            'log:line',
  APP_ERROR:           'app:error',
} as const

// Preview canvas target FPS
export const PREVIEW_TARGET_FPS = 30

// Audio meter update interval (ms)
export const AUDIO_METER_INTERVAL = 50

// Stats update interval (ms)
export const STATS_INTERVAL = 1000

// Local storage / persisted state keys
export const STORAGE_KEYS = {
  LAYOUT:         'cb:dock-layout',
  ACTIVE_PROFILE: 'cb:active-profile',
  WINDOW_STATE:   'cb:window-state',
} as const

// Dock layout defaults
export const DOCK = {
  LEFT_WIDTH_PCT:  15,
  RIGHT_WIDTH_PCT: 15,
  PREVIEW_HEIGHT_PCT: 70,
} as const

// Recording / streaming defaults
export const DEFAULTS = {
  STREAM_BITRATE_KBPS:  6000,
  RECORD_BITRATE_KBPS:  40000,
  AUDIO_BITRATE_KBPS:   160,
  REPLAY_BUFFER_SEC:    30,
  FPS:                  60,
  BASE_WIDTH:           1920,
  BASE_HEIGHT:          1080,
} as const
