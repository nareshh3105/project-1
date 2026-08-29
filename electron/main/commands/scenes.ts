import { randomUUID } from 'node:crypto'
import { command } from '../ipc'
import { getDb, now } from '../db'
import { toScene, toSource, type SceneRow, type SourceRow } from '../db/mappers'

const DEFAULT_COLLECTION = 'Default'
const DEFAULT_SCENE = 'Scene 1'

function listScenes(collectionId: string) {
  return getDb()
    .prepare(
      `SELECT * FROM scenes WHERE collection_id = ? ORDER BY order_index ASC`,
    )
    .all(collectionId) as SceneRow[]
}

function insertScene(collectionId: string, name: string, orderIndex: number) {
  const ts = now()
  const row: SceneRow = {
    id: randomUUID(),
    collection_id: collectionId,
    name,
    order_index: orderIndex,
    created_at: ts,
    updated_at: ts,
  }
  getDb()
    .prepare(
      `INSERT INTO scenes (id, collection_id, name, order_index, created_at, updated_at)
       VALUES (@id, @collection_id, @name, @order_index, @created_at, @updated_at)`,
    )
    .run(row)
  return row
}

export function registerSceneCommands() {
  /**
   * Called once at startup. Creates the default collection and its first scene
   * when the database is empty, and is otherwise a read.
   */
  command('init_default_collection', () => {
    const db = getDb()
    let collection = db
      .prepare(`SELECT * FROM scene_collections ORDER BY created_at ASC LIMIT 1`)
      .get() as { id: string } | undefined

    if (!collection) {
      const ts = now()
      const id = randomUUID()
      db.prepare(
        `INSERT INTO scene_collections (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run(id, DEFAULT_COLLECTION, ts, ts)
      collection = { id }
    }

    let scenes = listScenes(collection.id)
    if (scenes.length === 0) {
      insertScene(collection.id, DEFAULT_SCENE, 0)
      scenes = listScenes(collection.id)
    }

    return { collectionId: collection.id, scenes: scenes.map(toScene) }
  })

  command('list_scenes', ({ collectionId }) =>
    listScenes(collectionId as string).map(toScene),
  )

  command('create_scene', ({ collectionId, name }) => {
    const next = getDb()
      .prepare(
        `SELECT COALESCE(MAX(order_index) + 1, 0) AS n FROM scenes WHERE collection_id = ?`,
      )
      .get(collectionId as string) as { n: number }

    return toScene(insertScene(collectionId as string, name as string, next.n))
  })

  command('rename_scene', ({ id, name }) => {
    getDb()
      .prepare(`UPDATE scenes SET name = ?, updated_at = ? WHERE id = ?`)
      .run(name as string, now(), id as string)
  })

  command('delete_scene', ({ id }) => {
    // Sources are removed by ON DELETE CASCADE, which only works because
    // foreign_keys is enabled when the connection opens.
    getDb().prepare(`DELETE FROM scenes WHERE id = ?`).run(id as string)
  })

  command('reorder_scenes', ({ ids }) => {
    const db = getDb()
    const stmt = db.prepare(
      `UPDATE scenes SET order_index = ?, updated_at = ? WHERE id = ?`,
    )
    const ts = now()
    db.transaction((list: string[]) => {
      list.forEach((id, i) => stmt.run(i, ts, id))
    })(ids as string[])
  })

  command('duplicate_scene', ({ id, collectionId }) => {
    const db = getDb()
    const original = db
      .prepare(`SELECT * FROM scenes WHERE id = ?`)
      .get(id as string) as SceneRow | undefined
    if (!original) throw new Error('Scene not found')

    const next = db
      .prepare(
        `SELECT COALESCE(MAX(order_index) + 1, 0) AS n FROM scenes WHERE collection_id = ?`,
      )
      .get(collectionId as string) as { n: number }

    return db.transaction(() => {
      const scene = insertScene(
        collectionId as string,
        `${original.name} (copy)`,
        next.n,
      )

      const sources = db
        .prepare(`SELECT * FROM sources WHERE scene_id = ? ORDER BY order_index ASC`)
        .all(id as string) as SourceRow[]

      const insert = db.prepare(
        `INSERT INTO sources (id, scene_id, name, source_type, settings, order_index,
                              visible, locked, muted, volume, transform, created_at, updated_at)
         VALUES (@id, @scene_id, @name, @source_type, @settings, @order_index,
                 @visible, @locked, @muted, @volume, @transform, @created_at, @updated_at)`,
      )

      const copies = sources.map((s) => {
        const copy = { ...s, id: randomUUID(), scene_id: scene.id }
        insert.run(copy)
        return copy
      })

      return { scene: toScene(scene), sources: copies.map(toSource) }
    })()
  })
}
