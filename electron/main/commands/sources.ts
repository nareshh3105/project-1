import { randomUUID } from 'node:crypto'
import { command } from '../ipc'
import { getDb, now } from '../db'
import { toSource, type SourceRow } from '../db/mappers'

export function registerSourceCommands() {
  command('list_sources', ({ sceneId }) =>
    (
      getDb()
        .prepare(`SELECT * FROM sources WHERE scene_id = ? ORDER BY order_index ASC`)
        .all(sceneId as string) as SourceRow[]
    ).map(toSource),
  )

  command('add_source', ({ sceneId, name, sourceType, settings }) => {
    const db = getDb()
    const next = db
      .prepare(
        `SELECT COALESCE(MAX(order_index) + 1, 0) AS n FROM sources WHERE scene_id = ?`,
      )
      .get(sceneId as string) as { n: number }

    const ts = now()
    const row: SourceRow = {
      id: randomUUID(),
      scene_id: sceneId as string,
      name: name as string,
      source_type: sourceType as string,
      settings: (settings as string) ?? '{}',
      order_index: next.n,
      visible: 1,
      locked: 0,
      muted: 0,
      volume: 1.0,
      transform:
        '{"x":0,"y":0,"width":1920,"height":1080,"rotation":0,"scaleX":1,"scaleY":1}',
      created_at: ts,
      updated_at: ts,
    }

    db.prepare(
      `INSERT INTO sources (id, scene_id, name, source_type, settings, order_index,
                            visible, locked, muted, volume, transform, created_at, updated_at)
       VALUES (@id, @scene_id, @name, @source_type, @settings, @order_index,
               @visible, @locked, @muted, @volume, @transform, @created_at, @updated_at)`,
    ).run(row)

    return toSource(row)
  })

  command('rename_source', ({ id, name }) => {
    getDb()
      .prepare(`UPDATE sources SET name = ?, updated_at = ? WHERE id = ?`)
      .run(name as string, now(), id as string)
  })

  command('remove_source', ({ id }) => {
    getDb().prepare(`DELETE FROM sources WHERE id = ?`).run(id as string)
  })

  command('set_source_visible', ({ id, visible }) => {
    getDb()
      .prepare(`UPDATE sources SET visible = ?, updated_at = ? WHERE id = ?`)
      .run(visible ? 1 : 0, now(), id as string)
  })

  command('set_source_locked', ({ id, locked }) => {
    getDb()
      .prepare(`UPDATE sources SET locked = ?, updated_at = ? WHERE id = ?`)
      .run(locked ? 1 : 0, now(), id as string)
  })

  command('reorder_sources', ({ ids }) => {
    const db = getDb()
    const stmt = db.prepare(
      `UPDATE sources SET order_index = ?, updated_at = ? WHERE id = ?`,
    )
    const ts = now()
    db.transaction((list: string[]) => {
      list.forEach((id, i) => stmt.run(i, ts, id))
    })(ids as string[])
  })
}
