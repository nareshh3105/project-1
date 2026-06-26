import type { ID, Timestamp } from './common'
import type { SourceInstance } from './source'

export interface Scene {
  id: ID
  name: string
  order: number
  thumbnail: string | null      // base64 JPEG cached thumbnail
  sources: SourceInstance[]
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface SceneCollection {
  id: ID
  name: string
  scenes: Scene[]
  activeSceneId: ID | null
  previewSceneId: ID | null     // Studio Mode: scene visible in preview pane
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type SceneTransitionType =
  | 'cut'
  | 'fade'
  | 'slide'
  | 'swipe'
  | 'stinger'

export interface SceneTransition {
  type: SceneTransitionType
  durationMs: number
  assetPath?: string  // stinger video path
}
