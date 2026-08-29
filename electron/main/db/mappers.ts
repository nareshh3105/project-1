/**
 * Row-to-DTO mapping. The database uses snake_case; the renderer expects
 * camelCase, matching the shapes the Rust implementation produced via serde's
 * rename_all. Keeping these shapes identical is what allowed the frontend to
 * migrate untouched.
 */

export interface SceneRow {
  id: string
  collection_id: string
  name: string
  order_index: number
  created_at: number
  updated_at: number
}

export interface SourceRow {
  id: string
  scene_id: string
  name: string
  source_type: string
  settings: string
  order_index: number
  visible: number
  locked: number
  muted: number
  volume: number
  transform: string
  created_at: number
  updated_at: number
}

export interface CollectionRow {
  id: string
  name: string
  created_at: number
  updated_at: number
}

export const toScene = (r: SceneRow) => ({
  id: r.id,
  collectionId: r.collection_id,
  name: r.name,
  orderIndex: r.order_index,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export const toSource = (r: SourceRow) => ({
  id: r.id,
  sceneId: r.scene_id,
  name: r.name,
  sourceType: r.source_type,
  settings: r.settings,
  orderIndex: r.order_index,
  // SQLite has no boolean type; these are stored as 0/1.
  visible: !!r.visible,
  locked: !!r.locked,
  muted: !!r.muted,
  volume: r.volume,
  transform: r.transform,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export const toCollection = (r: CollectionRow) => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})
