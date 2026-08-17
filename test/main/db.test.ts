import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { initDatabase, closeDatabase, cleanupOrphans, getDb } from '../../electron/main/db'

let dbFile: string

function tempDbPath() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cb-db-')),
    'codebuilders.db',
  )
}

// Helpers that write rows directly, bypassing the command layer, so these
// tests exercise the schema rather than the commands built on top of it.
function insertCollection(db: Database.Database, name = 'Default') {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO scene_collections (id, name, created_at, updated_at) VALUES (?, ?, 0, 0)`,
  ).run(id, name)
  return id
}

function insertScene(db: Database.Database, collectionId: string, name = 'Scene 1') {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO scenes (id, collection_id, name, order_index, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0, 0)`,
  ).run(id, collectionId, name)
  return id
}

function insertSource(db: Database.Database, sceneId: string, name = 'Display') {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO sources (id, scene_id, name, source_type, settings, order_index,
                          visible, locked, muted, volume, transform, created_at, updated_at)
     VALUES (?, ?, ?, 'display', '{}', 0, 1, 0, 0, 1.0, '{}', 0, 0)`,
  ).run(id, sceneId, name)
  return id
}

const count = (db: Database.Database, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

beforeEach(() => {
  dbFile = tempDbPath()
  initDatabase(dbFile)
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true })
})

describe('schema', () => {
  it('creates every table the application needs', () => {
    const tables = (
      getDb()
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all() as { name: string }[]
    ).map((r) => r.name)

    expect(tables).toEqual(
      expect.arrayContaining(['scene_collections', 'scenes', 'sources', 'plugins']),
    )
  })

  it('is safe to run migrations twice', () => {
    closeDatabase()
    expect(() => initDatabase(dbFile)).not.toThrow()
    expect(count(getDb(), 'scenes')).toBe(0)
  })
})

describe('foreign key enforcement', () => {
  // The regression that motivated this suite: in the Rust build the pragma was
  // issued once against a connection pool, so most connections ran without it
  // and every ON DELETE CASCADE silently did nothing.
  //
  // better-sqlite3 enables foreign keys per connection by default, so these
  // tests would not fail merely from deleting the explicit pragma. What they
  // guard is the property itself — that cascades actually fire — which is what
  // would break under a driver change, a connection-pooling layer, or a stray
  // `foreign_keys = OFF` anywhere in the codebase.
  it('has foreign keys enabled on the live connection', () => {
    const [{ foreign_keys: enabled }] = getDb().pragma('foreign_keys') as {
      foreign_keys: number
    }[]
    expect(enabled).toBe(1)
  })

  it('rejects a scene whose collection does not exist', () => {
    expect(() => insertScene(getDb(), randomUUID())).toThrow(/FOREIGN KEY/i)
  })

  it('rejects a source whose scene does not exist', () => {
    expect(() => insertSource(getDb(), randomUUID())).toThrow(/FOREIGN KEY/i)
  })

  it('deletes scenes when their collection is deleted', () => {
    const db = getDb()
    const collection = insertCollection(db)
    insertScene(db, collection)
    insertScene(db, collection, 'Scene 2')
    expect(count(db, 'scenes')).toBe(2)

    db.prepare(`DELETE FROM scene_collections WHERE id = ?`).run(collection)
    expect(count(db, 'scenes')).toBe(0)
  })

  it('deletes sources when their scene is deleted', () => {
    const db = getDb()
    const scene = insertScene(db, insertCollection(db))
    insertSource(db, scene)
    expect(count(db, 'sources')).toBe(1)

    db.prepare(`DELETE FROM scenes WHERE id = ?`).run(scene)
    expect(count(db, 'sources')).toBe(0)
  })

  it('cascades two levels, from collection through scenes to sources', () => {
    const db = getDb()
    const collection = insertCollection(db)
    insertSource(db, insertScene(db, collection))
    expect(count(db, 'sources')).toBe(1)

    db.prepare(`DELETE FROM scene_collections WHERE id = ?`).run(collection)
    expect(count(db, 'scenes')).toBe(0)
    expect(count(db, 'sources')).toBe(0)
  })

  it('leaves unrelated collections untouched', () => {
    const db = getDb()
    const doomed = insertCollection(db, 'Doomed')
    const keep = insertCollection(db, 'Keep')
    insertScene(db, doomed)
    insertScene(db, keep, 'Kept scene')

    db.prepare(`DELETE FROM scene_collections WHERE id = ?`).run(doomed)

    const remaining = db.prepare(`SELECT name FROM scenes`).all() as { name: string }[]
    expect(remaining).toEqual([{ name: 'Kept scene' }])
  })
})

describe('cleanupOrphans', () => {
  // Rows stranded before cascades were enforced. They have to be inserted with
  // the pragma off, which is the only way they could have been created.
  function seedOrphans(db: Database.Database) {
    db.pragma('foreign_keys = OFF')
    const ghostCollection = randomUUID()
    const scene = insertScene(db, ghostCollection)
    insertSource(db, scene)
    insertSource(db, randomUUID())
    db.pragma('foreign_keys = ON')
  }

  it('removes scenes whose collection no longer exists', () => {
    const db = getDb()
    seedOrphans(db)
    expect(count(db, 'scenes')).toBe(1)

    const removed = cleanupOrphans(db)

    expect(count(db, 'scenes')).toBe(0)
    expect(removed.scenes).toBe(1)
  })

  it('removes sources stranded by the scenes it deletes', () => {
    const db = getDb()
    seedOrphans(db)
    expect(count(db, 'sources')).toBe(2)

    cleanupOrphans(db)

    expect(count(db, 'sources')).toBe(0)
  })

  it('leaves reachable rows alone', () => {
    const db = getDb()
    const scene = insertScene(db, insertCollection(db))
    insertSource(db, scene)
    seedOrphans(db)

    cleanupOrphans(db)

    expect(count(db, 'scenes')).toBe(1)
    expect(count(db, 'sources')).toBe(1)
  })

  it('reports nothing removed for a consistent database', () => {
    const db = getDb()
    insertSource(db, insertScene(db, insertCollection(db)))

    expect(cleanupOrphans(db)).toEqual({ scenes: 0, sources: 0 })
  })

  it('runs during initialisation, not only when called directly', () => {
    const db = getDb()
    seedOrphans(db)
    closeDatabase()

    initDatabase(dbFile)

    expect(count(getDb(), 'scenes')).toBe(0)
    expect(count(getDb(), 'sources')).toBe(0)
  })
})

describe('getDb', () => {
  it('throws rather than returning a null handle before initialisation', () => {
    closeDatabase()
    expect(() => getDb()).toThrow(/before initDatabase/i)
  })
})
