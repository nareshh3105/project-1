import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { IPC_EVENTS } from '@/lib/constants'
import { IpcError } from '@/lib/errors'
import type { RuntimeStats } from '@/stores/uiStore'
import type { SourceType } from '@/types'

// ── Typed invoke wrapper ──────────────────────────────────────────────────

async function cmd<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (err) {
    throw new IpcError(
      typeof err === 'string' ? err : `Command "${command}" failed`,
      { command, args }
    )
  }
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

  audio: {
    start:      () => cmd<void>('start_audio'),
    stop:       () => cmd<void>('stop_audio'),
    setVolume:  (id: string, volume: number) => cmd<void>('set_channel_volume', { id, volume }),
    setMuted:   (id: string, muted: boolean) => cmd<void>('set_channel_muted',  { id, muted }),
  },

  output: {
    checkFfmpeg:      () => cmd<boolean>('check_ffmpeg'),
    getRecordingPath: () => cmd<string>('get_recording_path'),
    startRecording:   (outputPath?: string) =>
      cmd<string>('start_recording', { outputPath: outputPath ?? null }),
    stopRecording:    () => cmd<void>('stop_recording'),
    startStreaming:   (rtmpUrl: string, streamKey: string) =>
      cmd<void>('start_streaming', { rtmpUrl, streamKey }),
    stopStreaming:    () => cmd<void>('stop_streaming'),
  },

  stats: {
    startPolling: () => cmd<void>('start_stats_polling'),
  },

  replay: {
    start:  (bufferSecs?: number) => cmd<void>('start_replay_buffer', { bufferSecs: bufferSecs ?? null }),
    stop:   () => cmd<void>('stop_replay_buffer'),
    save:   (outputPath?: string) => cmd<string>('save_replay', { outputPath: outputPath ?? null }),
  },

  updater: {
    check:   () => cmd<UpdateInfoPayload | null>('check_for_updates'),
    install: () => cmd<void>('install_update'),
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
    reorder:      (ids: string[]) =>
      cmd<void>('reorder_sources', { ids }),
  },
}

// ── Event listeners ───────────────────────────────────────────────────────

export function onStatsUpdate(cb: (stats: RuntimeStats) => void): Promise<UnlistenFn> {
  return listen<RuntimeStats>(IPC_EVENTS.STATS_UPDATE, (e) => cb(e.payload))
}

export function onPreviewFrame(cb: (dataUrl: string) => void): Promise<UnlistenFn> {
  return listen<string>(IPC_EVENTS.PREVIEW_FRAME, (e) => cb(e.payload))
}

export interface ChannelLevelPayload {
  id:     string
  peakL:  number
  peakR:  number
  rmsL:   number
  rmsR:   number
}

export function onAudioLevels(cb: (levels: ChannelLevelPayload[]) => void): Promise<UnlistenFn> {
  return listen<ChannelLevelPayload[]>(IPC_EVENTS.AUDIO_LEVELS, (e) => cb(e.payload))
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
  return listen<ReplayStatusPayload>('output:replay-status', (e) => cb(e.payload))
}

export interface UpdateInfoPayload {
  version:        string
  currentVersion: string
  notes:          string | null
  pubDate:        string | null
}

export interface DownloadProgressPayload {
  downloaded: number        // usize from Rust
  total:      number | null
}

export function onUpdateDownloadProgress(cb: (p: DownloadProgressPayload) => void): Promise<UnlistenFn> {
  return listen<DownloadProgressPayload>('updater:download-progress', (e) => cb(e.payload))
}

export function onLogLine(cb: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>(IPC_EVENTS.LOG_LINE, (e) => cb(e.payload))
}

export function onAppError(cb: (err: { code: string; message: string }) => void): Promise<UnlistenFn> {
  return listen<{ code: string; message: string }>(IPC_EVENTS.APP_ERROR, (e) => cb(e.payload))
}
