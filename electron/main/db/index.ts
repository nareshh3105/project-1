import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('Database accessed before initDatabase()')
  return db
}

export function initDatabase(dbPath?: string): Database.Database {
  const file = dbPath ?? path.join(app.getPath('userData'), 'codebuilders.db')
  fs.mkdirSync(path.dirname(file), { recursive: true })

  db = new Database(file)

  // foreign_keys is a per-connection pragma that SQLite defaults to OFF. The
  // Rust implementation set it as a one-off query against a connection pool,
  // so most connections never had it and ON DELETE CASCADE never fired —
  // deleting a collection stranded its scenes, and deleting a scene stranded
  // its sources. better-sqlite3 uses a single connection, so setting it here
  // covers every statement, but it must stay next to the connection open.
  db.pragma('journal_mode = WAL')
  // better-sqlite3 already enables foreign keys per connection, unlike raw
  // SQLite where the pragma defaults to OFF. Set it anyway so the requirement
  // is explicit rather than inherited from driver behaviour that could change.
  // The Rust build was bitten by exactly this: sqlx makes no such guarantee,
  // and the pragma was issued once against a pool, so most connections ran
  // without it and ON DELETE CASCADE silently never fired.
  db.pragma('foreign_keys = ON')

  migrate(db)
  return db
}

export function closeDatabase() {
  db?.close()
  db = null
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS scene_collections (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id            TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      name          TEXT NOT NULL,
      order_index   INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      FOREIGN KEY (collection_id)
        REFERENCES scene_collections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sources (
      id          TEXT PRIMARY KEY,
      scene_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      source_type TEXT NOT NULL,
      settings    TEXT NOT NULL DEFAULT '{}',
      order_index INTEGER NOT NULL DEFAULT 0,
      visible     INTEGER NOT NULL DEFAULT 1,
      locked      INTEGER NOT NULL DEFAULT 0,
      muted       INTEGER NOT NULL DEFAULT 0,
      volume      REAL NOT NULL DEFAULT 1.0,
      transform   TEXT NOT NULL DEFAULT '{"x":0,"y":0,"width":1920,"height":1080,"rotation":0,"scaleX":1,"scaleY":1}',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plugins (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      version      TEXT NOT NULL DEFAULT '0.0.0',
      phase        TEXT NOT NULL DEFAULT 'js_sandbox',
      state        TEXT NOT NULL DEFAULT 'disabled',
      manifest     TEXT NOT NULL DEFAULT '{}',
      config_path  TEXT NOT NULL DEFAULT '',
      installed_at INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scenes_collection ON scenes(collection_id);
    CREATE INDEX IF NOT EXISTS idx_sources_scene     ON sources(scene_id);
  `)

  cleanupOrphans(d)
}

/**
 * Clears rows stranded by deletes that ran while foreign keys were unenforced.
 * Such rows are unreachable from the interface — a scene whose collection is
 * gone can never be listed — so without this they accumulate indefinitely.
 *
 * Sources are cleared first so scenes removed in the second statement cannot
 * strand more of them.
 */
export function cleanupOrphans(d: Database.Database) {
  const orphanSources = d.prepare(
    `DELETE FROM sources WHERE scene_id NOT IN (SELECT id FROM scenes)`,
  )
  const orphanScenes = d.prepare(
    `DELETE FROM scenes WHERE collection_id NOT IN (SELECT id FROM scene_collections)`,
  )

  const before = orphanSources.run().changes
  const scenes = orphanScenes.run().changes
  const cascaded = orphanSources.run().changes

  const sources = before + cascaded
  if (scenes + sources > 0) {
    console.info(
      `[db] removed ${scenes} orphaned scene(s) and ${sources} orphaned source(s)`,
    )
  }
  return { scenes, sources }
}

export const now = () => Date.now()
