import { IPC_EVENTS } from '@/lib/constants'
import { IpcError } from '@/lib/errors'
import type { RuntimeStats } from '@/stores/uiStore'
import type { SourceType } from '@/types'

// ── Bridge ────────────────────────────────────────────────────────────────
// Exposed by electron/preload. Deliberately the only place the renderer
// reaches the main process — every other module goes through `ipc` below.

export type UnlistenFn = () => void

interface Bridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  on(event: string, callback: (payload: unknown) => void): UnlistenFn
}

/** What an output is asked to produce. Mirrors SessionParams in shared/host.ts. */
export type OutputParams = import('../../shared/host').SessionParams

declare global {
  interface Window {
    codebuilders?: Bridge
  }
}

function bridge(): Bridge {
  const api = window.codebuilders
  if (!api) {
    throw new Error(
      'Backend bridge unavailable — the preload script did not load. ' +
        'Running the renderer outside Electron is not supported.',
    )
  }
  return api
}

// ── Typed invoke wrapper ──────────────────────────────────────────────────

async function cmd<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await bridge().invoke<T>(command, args)
  } catch (err) {
    throw new IpcError(
      typeof err === 'string' ? err : `Command "${command}" failed`,
      { command, args }
    )
  }
}

/** Subscribe to a backend event, matching the previous listen() signature. */
function listen<T>(
  event: string,
  handler: (e: { payload: T }) => void,
): Promise<UnlistenFn> {
  return Promise.resolve(
    bridge().on(event, (payload) => handler({ payload: payload as T })),
  )
}

// ── DTOs (mirrors Rust structs, camelCase via serde rename_all) ───────────

export interface SceneDto {
  id: string
  collectionId: string
  name: string
  orderIndex: number
  createdAt: number
  updatedAt: number
}

export interface SourceDto {
  id: string
  sceneId: string
  name: string
  sourceType: SourceType
  settings: string        // JSON text — parse on use
  orderIndex: number
  visible: boolean
  locked: boolean
  muted: boolean
  volume: number
  transform: string       // JSON text — parse on use
  createdAt: number
  updatedAt: number
}

/** A screen or window that can be captured, as shown in the picker. */
export interface CaptureSourceDto {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string | null
  icon: string | null
}

export interface InitResult {
  collectionId: string
  scenes: SceneDto[]
}

export interface DuplicateResult {
  scene: SceneDto
  sources: SourceDto[]
}

export interface CollectionDto {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface CollectionInitResult {
  collection: CollectionDto
  scenes: SceneDto[]
}

export interface PluginDto {
  id:          string
  name:        string
  version:     string
  phase:       string
  state:       string
  manifest:    string   // JSON string of PluginManifest
  configPath:  string
  installedAt: number
  updatedAt:   number
}

// ── IPC surface ───────────────────────────────────────────────────────────

export const ipc = {
  app: {
    getVersion:   () => cmd<string>('get_app_version'),
    getPlatform:  () => cmd<{ os: string; arch: string; version: string }>('get_platform_info'),
    /** Puts the diagnostics report on the clipboard; resolves to its length. */
    copyDiagnostics: () => cmd<number>('copy_diagnostics'),
  },

  collection: {
    list:      () =>
      cmd<CollectionDto[]>('list_collections'),
    create:    (name: string) =>
      cmd<CollectionInitResult>('create_collection', { name }),
    rename:    (id: string, name: string) =>
      cmd<void>('rename_collection', { id, name }),
    delete:    (id: string) =>
      cmd<void>('delete_collection', { id }),
    duplicate: (id: string) =>
      cmd<CollectionInitResult>('duplicate_collection', { id }),
  },

  scene: {
    initDefault:  () =>
      cmd<InitResult>('init_default_collection'),
    list:         (collectionId: string) =>
      cmd<SceneDto[]>('list_scenes', { collectionId }),
    create:       (collectionId: string, name: string) =>
      cmd<SceneDto>('create_scene', { collectionId, name }),
    rename:       (id: string, name: string) =>
      cmd<void>('rename_scene', { id, name }),
    delete:       (id: string) =>
      cmd<void>('delete_scene', { id }),
    reorder:      (ids: string[]) =>
      cmd<void>('reorder_scenes', { ids }),
    duplicate:    (id: string, collectionId: string) =>
      cmd<DuplicateResult>('duplicate_scene', { id, collectionId }),
  },

  preview: {
    start: () => cmd<void>('start_preview'),
    stop:  () => cmd<void>('stop_preview'),
  },


  output: {
    checkFfmpeg:      () => cmd<boolean>('check_ffmpeg'),
    getRecordingPath: () => cmd<string>('get_recording_path'),
    startRecording:   (outputPath: string | undefined, format: 'mkv' | 'mp4', params: OutputParams) =>
      cmd<string>('start_recording', { outputPath: outputPath ?? null, format, params }),
    stopRecording:    () => cmd<void>('stop_recording'),
    startStreaming:   (rtmpUrl: string, streamKey: string, params: OutputParams) =>
      cmd<void>('start_streaming', { rtmpUrl, streamKey, params }),
    stopStreaming:    () => cmd<void>('stop_streaming'),
    openRecordingsFolder:  () => cmd<void>('open_recordings_folder'),
    openLogsFolder:        () => cmd<void>('open_logs_folder'),
    getLogsPath:           () => cmd<string>('get_logs_path'),
    openScreenshotsFolder: () => cmd<void>('open_screenshots_folder'),
    startVirtualCamera:  (params: OutputParams) => cmd<string>('start_virtual_camera', { params }),
    stopVirtualCamera:   () => cmd<void>('stop_virtual_camera'),
  },

  host: {
    /** Publishes the scene and mixer state the output host composes and mixes from. */
    pushState: (snapshot: import('../../shared/host').HostSnapshot) =>
      cmd<void>('host_push_state', { snapshot }),
  },

  stats: {
    startPolling: () => cmd<void>('start_stats_polling'),
  },

  window: {
    setFullscreen:  (fullscreen: boolean) =>
      cmd<void>('window_set_fullscreen', { fullscreen }),
    isFullscreen:   () => cmd<boolean>('window_is_fullscreen'),
    setAlwaysOnTop: (alwaysOnTop: boolean) =>
      cmd<void>('window_set_always_on_top', { alwaysOnTop }),
    close:          () => cmd<void>('window_close'),
  },

  file: {
    saveDialog: (defaultPath?: string, filters?: { name: string; extensions: string[] }[]) =>
      cmd<string | null>('show_save_dialog', { defaultPath, filters }),
    openDialog: (filters?: { name: string; extensions: string[] }[]) =>
      cmd<string | null>('show_open_dialog', { filters }),
    readText:   (path: string) => cmd<string>('read_text_file', { path }),
    /** A picture the user chose, as a data URL. */
    readImage:  (path: string) => cmd<string>('read_image_file', { path }),
    writeText:  (path: string, contents: string) =>
      cmd<void>('write_text_file', { path, contents }),
  },

  hotkeys: {
    /** Replaces the OS-level shortcut set. Resolves to accelerators refused. */
    register:   (shortcuts: { accelerator: string; action: string }[]) =>
      cmd<string[]>('register_shortcuts', { shortcuts }),
    unregister: () => cmd<void>('unregister_shortcuts'),
  },

  replay: {
    start:  (bufferSecs: number, params: OutputParams) => cmd<void>('start_replay_buffer', { bufferSecs, params }),
    stop:   () => cmd<void>('stop_replay_buffer'),
    save:   (outputPath?: string) => cmd<string>('save_replay', { outputPath: outputPath ?? null }),
  },

  updater: {
    check:   () => cmd<UpdateInfoPayload | null>('check_for_updates'),
    install: () => cmd<void>('install_update'),
  },

  screenshot: {
    take: (outputPath?: string) => cmd<string>('take_screenshot', { outputPath: outputPath ?? null }),
  },

  plugin: {
    list:       () =>
      cmd<PluginDto[]>('list_plugins'),
    discover:   () =>
      cmd<PluginDto[]>('discover_plugins'),
    enable:     (id: string) =>
      cmd<void>('enable_plugin', { id }),
    disable:    (id: string) =>
      cmd<void>('disable_plugin', { id }),
    uninstall:  (id: string) =>
      cmd<void>('uninstall_plugin', { id }),
    openFolder: () =>
      cmd<void>('open_plugins_folder'),
    getFolder:  () =>
      cmd<string>('get_plugins_folder'),
    readScript: (id: string) =>
      cmd<string>('read_plugin_script', { id }),
  },

  source: {
    list:         (sceneId: string) =>
      cmd<SourceDto[]>('list_sources', { sceneId }),
    add:          (sceneId: string, name: string, sourceType: string, settings: string) =>
      cmd<SourceDto>('add_source', { sceneId, name, sourceType, settings }),
    rename:       (id: string, name: string) =>
      cmd<void>('rename_source', { id, name }),
    remove:       (id: string) =>
      cmd<void>('remove_source', { id }),
    setVisible:   (id: string, visible: boolean) =>
      cmd<void>('set_source_visible', { id, visible }),
    setLocked:    (id: string, locked: boolean) =>
      cmd<void>('set_source_locked', { id, locked }),
    setTransform: (id: string, transform: string) =>
      cmd<void>('set_source_transform', { id, transform }),
    reorder:      (ids: string[]) =>
      cmd<void>('reorder_sources', { ids }),
    updateSettings: (id: string, settings: string) =>
      cmd<void>('update_source_settings', { id, settings }),
  },

  capture: {
    /** Screens and windows that can be captured now, with thumbnails. */
    listSources:  (kinds?: ('screen' | 'window')[]) =>
      cmd<CaptureSourceDto[]>('list_capture_sources', { kinds }),
    /**
     * Declares what the next getDisplayMedia call may receive. Without it the
     * request is refused; a choice is used once and expires.
     */
    prepare:      (sourceId: string, audio = false) =>
      cmd<void>('prepare_capture', { sourceId, audio }),
  },
}

// ── Event listeners ───────────────────────────────────────────────────────

export function onStatsUpdate(cb: (stats: RuntimeStats) => void): Promise<UnlistenFn> {
  return listen<RuntimeStats>(IPC_EVENTS.STATS_UPDATE, (e) => cb(e.payload))
}

export interface RecordingStatusPayload { active: boolean; filePath: string | null }
export interface StreamingStatusPayload { active: boolean }
export interface ReplayStatusPayload    { active: boolean }

export function onRecordingStatus(cb: (p: RecordingStatusPayload) => void): Promise<UnlistenFn> {
  return listen<RecordingStatusPayload>(IPC_EVENTS.RECORDING_STATUS, (e) => cb(e.payload))
}

export function onStreamingStatus(cb: (p: StreamingStatusPayload) => void): Promise<UnlistenFn> {
  return listen<StreamingStatusPayload>(IPC_EVENTS.STREAM_STATUS, (e) => cb(e.payload))
}

export function onReplayStatus(cb: (p: ReplayStatusPayload) => void): Promise<UnlistenFn> {
  return listen<ReplayStatusPayload>(IPC_EVENTS.REPLAY_STATUS, (e) => cb(e.payload))
}

export interface UpdateInfoPayload {
  version:        string
  currentVersion: string
  notes:          string | null
  pubDate:        string | null
}

export interface DownloadProgressPayload {
  downloaded: number
  total:      number | null
}

export function onUpdateDownloadProgress(cb: (p: DownloadProgressPayload) => void): Promise<UnlistenFn> {
  return listen<DownloadProgressPayload>(IPC_EVENTS.UPDATER_PROGRESS, (e) => cb(e.payload))
}

export interface VirtualCameraStatusPayload {
  active: boolean
  url:    string | null
}

export function onVirtualCameraStatus(cb: (p: VirtualCameraStatusPayload) => void): Promise<UnlistenFn> {
  return listen<VirtualCameraStatusPayload>(IPC_EVENTS.VCAM_STATUS, (e) => cb(e.payload))
}

export interface OutputErrorPayload { kind: string; message: string }

export function onOutputError(cb: (p: OutputErrorPayload) => void): Promise<UnlistenFn> {
  return listen<OutputErrorPayload>(IPC_EVENTS.OUTPUT_ERROR, (e) => cb(e.payload))
}

export function onHotkeyPressed(cb: (action: string) => void): Promise<UnlistenFn> {
  return listen<{ action: string }>(IPC_EVENTS.HOTKEY_PRESSED, (e) => cb(e.payload.action))
}
