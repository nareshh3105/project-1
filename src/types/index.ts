// Central type barrel — import all domain types from here

export type {
  ID,
  Timestamp,
  Point2D,
  Size2D,
  Rect,
  Transform,
  LoadingState,
  AsyncState,
  Resolution,
  FrameRate,
} from './common'

export { STANDARD_RESOLUTIONS, FRAME_RATES } from './common'

export type {
  Scene,
  SceneCollection,
  SceneTransition,
  SceneTransitionType,
} from './scene'

export type {
  SourceType,
  SourceInstance,
  SourceDefinition,
  SourceFilter,
  FilterType,
  SourceSettings,
  DisplayCaptureSettings,
  WindowCaptureSettings,
  WebcamSettings,
  BrowserSourceSettings,
  ImageSettings,
  MediaSourceSettings,
  ColorSourceSettings,
  TextSettings,
} from './source'

export type {
  DBLevel,
  AudioTrackLevels,
  MixerChannel,
  AudioDevice,
  AudioSettings,
} from './audio'

export { DB_SILENCE, DB_UNITY, DB_CLIP, DB_CAUTION } from './audio'

export type {
  StreamServiceType,
  StreamService,
  StreamState,
  StreamStatus,
  RecordingFormat,
  RecordingState,
  RecordingStatus,
  VirtualCameraStatus,
  ReplayBufferStatus,
  VideoEncoder,
  AudioEncoder,
  VideoEncoderSettings,
  AudioEncoderSettings,
  OutputSettings,
} from './output'

export type {
  Profile,
  GeneralSettings,
  VideoSettings,
  AdvancedSettings,
  AppSettings,
} from './settings'

export type {
  ModifierKey,
  KeyBinding,
  Hotkey,
  HotkeyAction,
} from './hotkey'

export { DEFAULT_HOTKEYS } from './hotkey'

export type {
  PluginPhase,
  PluginManifest,
  PluginPermission,
  PluginState,
  Plugin,
} from './plugin'
