import { randomUUID } from 'node:crypto'
import { command } from '../ipc'
import { getDb, now } from '../db'
import {
  toCollection, toScene,
  type CollectionRow, type SceneRow, type SourceRow,
} from '../db/mappers'

function scenesOf(collectionId: string) {
  return getDb()
    .prepare(`SELECT * FROM scenes WHERE collection_id = ? ORDER BY order_index ASC`)
    .all(collectionId) as SceneRow[]
}

function insertCollection(name: string): CollectionRow {
  const ts = now()
  const row: CollectionRow = {
    id: randomUUID(), name, created_at: ts, updated_at: ts,
  }
  getDb()
    .prepare(
      `INSERT INTO scene_collections (id, name, created_at, updated_at)
       VALUES (@id, @name, @created_at, @updated_at)`,
    )
    .run(row)
  return row
}

export function registerCollectionCommands() {
  command('list_collections', () =>
    (
      getDb()
        .prepare(`SELECT * FROM scene_collections ORDER BY created_at ASC`)
        .all() as CollectionRow[]
    ).map(toCollection),
  )

  command('create_collection', ({ name }) => {
    const db = getDb()
    return db.transaction(() => {
      const collection = insertCollection(name as string)
      const ts = now()
      db.prepare(
        `INSERT INTO scenes (id, collection_id, name, order_index, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
      ).run(randomUUID(), collection.id, 'Scene 1', ts, ts)

      return {
        collection: toCollection(collection),
        scenes: scenesOf(collection.id).map(toScene),
      }
    })()
  })

  command('rename_collection', ({ id, name }) => {
    getDb()
      .prepare(`UPDATE scene_collections SET name = ?, updated_at = ? WHERE id = ?`)
      .run(name as string, now(), id as string)
  })

  command('delete_collection', ({ id }) => {
    const db = getDb()
    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM scene_collections`)
      .get() as { n: number }
    if (n <= 1) throw new Error('Cannot delete the last scene collection')

    // Scenes and their sources go with it, via ON DELETE CASCADE.
    db.prepare(`DELETE FROM scene_collections WHERE id = ?`).run(id as string)
  })

  command('duplicate_collection', ({ id }) => {
    const db = getDb()
    const original = db
      .prepare(`SELECT * FROM scene_collections WHERE id = ?`)
      .get(id as string) as CollectionRow | undefined
    if (!original) throw new Error('Scene collection not found')

    return db.transaction(() => {
      const copy = insertCollection(`${original.name} (copy)`)

      const insertScene = db.prepare(
        `INSERT INTO scenes (id, collection_id, name, order_index, created_at, updated_at)
         VALUES (@id, @collection_id, @name, @order_index, @created_at, @updated_at)`,
      )
      const insertSource = db.prepare(
        `INSERT INTO sources (id, scene_id, name, source_type, settings, order_index,
                              visible, locked, muted, volume, transform, created_at, updated_at)
         VALUES (@id, @scene_id, @name, @source_type, @settings, @order_index,
                 @visible, @locked, @muted, @volume, @transform, @created_at, @updated_at)`,
      )

      for (const scene of scenesOf(original.id)) {
        const newScene = { ...scene, id: randomUUID(), collection_id: copy.id }
        insertScene.run(newScene)

        const sources = db
          .prepare(`SELECT * FROM sources WHERE scene_id = ? ORDER BY order_index ASC`)
          .all(scene.id) as SourceRow[]

        for (const src of sources) {
          insertSource.run({ ...src, id: randomUUID(), scene_id: newScene.id })
        }
      }

      return {
        collection: toCollection(copy),
        scenes: scenesOf(copy.id).map(toScene),
      }
    })()
  })
}
