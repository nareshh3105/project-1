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

  try {
    runMigrations(db, MIGRATIONS, (from) => backupDatabase(db!, file, from))
  } catch (err) {
    // Leave nothing half-open: a caller that catches this must be able to
    // retry or quit without a live handle on a database it could not use.
    db.close()
    db = null
    throw err
  }
  cleanupOrphans(db)
  return db
}

export function closeDatabase() {
  db?.close()
  db = null
}

/**
 * Schema versions.
 *
 * The database used to be built by a single block of CREATE TABLE IF NOT
 * EXISTS statements, which creates what is missing and never alters what is
 * there. The first build to add a column would have left every existing
 * install without it and failing on the first query that used it — for the
 * people testing successive builds, that is a broken app after each update.
 *
 * Instead the schema is a list of numbered steps, applied in order and
 * recorded in SQLite's `user_version`. To change the schema, APPEND a step
 * with the next number. Never edit or reorder one that has shipped: installs
 * that already ran it will not run it again.
 *
 * Version 1 is the schema as it stood before versioning, written with IF NOT
 * EXISTS so a database from an earlier build (user_version 0, tables already
 * present) adopts version 1 without any change to its data.
 *
 * A step that rebuilds a table needs foreign keys switched off, and SQLite
 * ignores that pragma inside a transaction, so do it in a step of its own
 * outside this runner rather than inside `up`.
 */
export interface Migration {
  version: number
  description: string
  up: (d: Database.Database) => void
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'initial schema',
    up: (d) => {
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
    },
  },
]

/** Raised when the data on disk was written by a newer build than this one. */
export class SchemaTooNewError extends Error {
  constructor(readonly found: number, readonly supported: number) {
    super(
      `Your CodeBuilders data was created by a newer version of the app ` +
        `(data version ${found}; this version understands up to ${supported}). ` +
        `Install the latest CodeBuilders, or your data may be damaged if this ` +
        `older version were to change it.`,
    )
    this.name = 'SchemaTooNewError'
  }
}

const hasUserTables = (d: Database.Database) =>
  (d.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .get() as { n: number }).n > 0

/**
 * Brings `d` up to the latest version, one transaction per step so a step that
 * fails leaves the database exactly as it was before that step. Returns the
 * resulting version.
 *
 * `beforeMigrating` runs once, only when there is existing data to protect.
 */
export function runMigrations(
  d: Database.Database,
  migrations: readonly Migration[] = MIGRATIONS,
  beforeMigrating?: (fromVersion: number) => void,
): number {
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0)
  const current = d.pragma('user_version', { simple: true }) as number

  // Opening newer data with older code is how a tester who installs a previous
  // build corrupts their own work; refuse rather than guess.
  if (current > latest) throw new SchemaTooNewError(current, latest)

  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version)
  if (pending.length === 0) return current

  if (hasUserTables(d)) beforeMigrating?.(current)

  for (const m of pending) {
    d.transaction(() => {
      m.up(d)
      d.pragma(`user_version = ${m.version}`)
    })()
  }
  return latest
}

/** How many safety copies to keep beside the database. */
const KEEP_BACKUPS = 3

/**
 * Copies the database aside before a migration changes it, so a bad step can
 * be undone by hand. The WAL is folded in first, otherwise the copy would miss
 * whatever had not yet been checkpointed.
 */
export function backupDatabase(d: Database.Database, file: string, fromVersion: number): string {
  d.pragma('wal_checkpoint(TRUNCATE)')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = `${file}.bak-v${fromVersion}-${stamp}`
  fs.copyFileSync(file, dest)

  const dir = path.dirname(file)
  const prefix = `${path.basename(file)}.bak-`
  const backups = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) {
    fs.rmSync(path.join(dir, old), { force: true })
  }
  return dest
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
