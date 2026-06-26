import type { ID, Timestamp } from './common'
import type { SourceType } from './source'

export type PluginPhase = 'js_sandbox' | 'native_cdylib'

export interface PluginManifest {
  id: string
  name: string
  version: string
  author: string
  description: string
  phase: PluginPhase
  permissions: PluginPermission[]
  entryPoint: string
  sourceTypes?: SourceType[]
  filterTypes?: string[]
}

export type PluginPermission =
  | 'scene_read'
  | 'scene_write'
  | 'source_read'
  | 'source_write'
  | 'audio_read'
  | 'output_read'
  | 'output_write'
  | 'settings_read'
  | 'hotkey_register'
  | 'ipc'
  | 'filesystem'

export type PluginState = 'disabled' | 'enabled' | 'error' | 'loading'

export interface Plugin {
  id: ID
  manifest: PluginManifest
  state: PluginState
  errorMessage: string | null
  loadedAt: Timestamp | null
  configPath: string
}
