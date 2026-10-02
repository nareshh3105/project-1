import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  initDatabase, closeDatabase, getDb,
  MIGRATIONS, runMigrations, SchemaTooNewError, type Migration,
} from '../../electron/main/db'

/**
 * Schema versioning. Testers install successive builds over each other, so an
 * upgrade has to keep their data and a downgrade must not damage it.
 *
 * Kept apart from db.test.ts, whose top-level hook opens a database for every
 * test: these tests open their own, and two live handles on Windows stop the
 * temp directory being removed.
 */

const dirs: string[] = []

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-mig-'))
  dirs.push(dir)
  return path.join(dir, 'codebuilders.db')
}

function insertCollection(db: Database.Database, name = 'Default') {
  const id = randomUUID()
  db.prepare(`INSERT INTO scene_collections (id, name, created_at, updated_at) VALUES (?, ?, 0, 0)`).run(id, name)
  return id
}

function insertScene(db: Database.Database, collectionId: string, name = 'Scene 1') {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO scenes (id, collection_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 0)`,
  ).run(id, collectionId, name)
  return id
}

function insertSource(db: Database.Database, sceneId: string, name = 'Display') {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO sources (id, scene_id, name, source_type, settings, order_index, created_at, updated_at)
     VALUES (?, ?, ?, 'display_capture', '{}', 0, 0, 0)`,
  ).run(id, sceneId, name)
  return id
}

afterEach(() => {
  closeDatabase()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('schema versioning', () => {
  const version = (d: Database.Database) => d.pragma('user_version', { simple: true }) as number
  const tables = (d: Database.Database) =>
    (d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[])
      .map((t) => t.name)
  const backupsBeside = (file: string) =>
    fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.bak-'))

  /** A database exactly as the unversioned builds (0.1 - 0.5) left it. */
  function legacyDb(file: string) {
    const d = new Database(file)
    d.pragma('journal_mode = WAL')
    d.pragma('foreign_keys = ON')
    MIGRATIONS[0].up(d) // the old schema, with user_version never set
    const c = insertCollection(d, 'My project')
    const s = insertScene(d, c, 'Intro')
    insertSource(d, s, 'Webcam')
    d.close()
  }

  it('numbers its steps 1..n with no gaps or repeats', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1))
  })

  it('stamps a new database with the latest version', () => {
    const d = initDatabase(tempDbPath())
    expect(version(d)).toBe(MIGRATIONS.length)
    expect(tables(d)).toEqual(expect.arrayContaining(['scene_collections', 'scenes', 'sources', 'plugins']))
  })

  it('does not back up a database it has just created', () => {
    const file = tempDbPath()
    initDatabase(file)
    expect(backupsBeside(file)).toEqual([])
  })

  it('adopts an unversioned database from an earlier build, keeping its data', () => {
    const file = tempDbPath()
    legacyDb(file)

    const d = initDatabase(file)

    expect(version(d)).toBe(MIGRATIONS.length)
    expect(d.prepare('SELECT name FROM scenes').all()).toEqual([{ name: 'Intro' }])
    expect(d.prepare('SELECT name FROM sources').all()).toEqual([{ name: 'Webcam' }])
  })

  it('takes a safety copy before changing a database that holds data', () => {
    const file = tempDbPath()
    legacyDb(file)

    initDatabase(file)

    const backups = backupsBeside(file)
    expect(backups).toHaveLength(1)
    // The copy is a working database holding the data as it was.
    const copy = new Database(path.join(path.dirname(file), backups[0]), { readonly: true })
    expect(copy.prepare('SELECT name FROM scenes').all()).toEqual([{ name: 'Intro' }])
    copy.close()
  })

  it('leaves an up-to-date database alone on the next launch', () => {
    const file = tempDbPath()
    initDatabase(file)
    closeDatabase()

    const d = initDatabase(file)

    expect(version(d)).toBe(MIGRATIONS.length)
    expect(backupsBeside(file)).toEqual([])
  })

  describe('opening data from a newer build', () => {
    function newerDb(file: string) {
      const d = new Database(file)
      MIGRATIONS[0].up(d)
      insertCollection(d, 'Made by the future')
      d.pragma('user_version = 99')
      d.close()
    }

    it('refuses, and says what to do', () => {
      const file = tempDbPath()
      newerDb(file)

      expect(() => initDatabase(file)).toThrow(SchemaTooNewError)
      expect(() => initDatabase(file)).toThrow(/newer version/)
    })

    it('does not touch the data it refused to open', () => {
      const file = tempDbPath()
      newerDb(file)
      try { initDatabase(file) } catch { /* expected */ }

      const d = new Database(file, { readonly: true })
      expect(version(d)).toBe(99)
      expect(d.prepare('SELECT name FROM scene_collections').all()).toEqual([{ name: 'Made by the future' }])
      d.close()
    })

    it('does not leave the connection open', () => {
      const file = tempDbPath()
      newerDb(file)
      try { initDatabase(file) } catch { /* expected */ }

      expect(() => getDb()).toThrow(/before initDatabase/)
    })
  })

  describe('applying steps', () => {
    const step = (n: number, sql: string): Migration => ({
      version: n, description: `step ${n}`, up: (d) => { d.exec(sql) },
    })
    const memory = () => new Database(':memory:')
    const track = (ran: number[], n: number, fail = false): Migration => ({
      version: n,
      description: '',
      up: () => { ran.push(n); if (fail) throw new Error('boom') },
    })

    it('runs steps in order', () => {
      const d = memory()
      const ran: number[] = []

      runMigrations(d, [track(ran, 3), track(ran, 1), track(ran, 2)])

      expect(ran).toEqual([1, 2, 3])
      expect(version(d)).toBe(3)
    })

    it('runs only the steps that have not run', () => {
      const d = memory()
      const ran: number[] = []
      d.pragma('user_version = 2')

      runMigrations(d, [track(ran, 1), track(ran, 2), track(ran, 3)])

      expect(ran).toEqual([3])
    })

    // The upgrade a tester actually goes through: a later build adds a column,
    // and the rows they already have must survive with a sensible value in it.
    it('adds a column to a database that already has rows', () => {
      const file = tempDbPath()
      legacyDb(file)
      const d = new Database(file)
      d.pragma('foreign_keys = ON')

      runMigrations(d, [
        MIGRATIONS[0],
        step(2, `ALTER TABLE scenes ADD COLUMN notes TEXT NOT NULL DEFAULT ''`),
      ])

      expect(d.prepare('SELECT name, notes FROM scenes').all()).toEqual([{ name: 'Intro', notes: '' }])
      expect(version(d)).toBe(2)
      d.close()
    })

    it('undoes a step that fails part way, and stops there', () => {
      const d = memory()
      const broken: Migration = {
        version: 2,
        description: 'breaks',
        up: (db) => {
          db.exec('CREATE TABLE half_done (id TEXT)')
          throw new Error('boom')
        },
      }

      expect(() => runMigrations(d, [step(1, 'CREATE TABLE a (id TEXT)'), broken])).toThrow('boom')

      expect(version(d)).toBe(1)
      expect(tables(d)).toEqual(['a'])
    })

    it('does not run later steps after one fails', () => {
      const d = memory()
      const ran: number[] = []

      expect(() => runMigrations(d, [track(ran, 1), track(ran, 2, true), track(ran, 3)])).toThrow()

      expect(ran).toEqual([1, 2])
    })

    it('only offers to back up when there is data to protect', () => {
      const calls: number[] = []

      runMigrations(memory(), [step(1, 'CREATE TABLE a (id TEXT)')], (from) => calls.push(from))
      expect(calls).toEqual([])

      const withData = memory()
      withData.exec('CREATE TABLE existing (id TEXT)')
      runMigrations(withData, [step(1, 'CREATE TABLE a (id TEXT)')], (from) => calls.push(from))
      expect(calls).toEqual([0])
    })
  })

  it('keeps only the three most recent safety copies', () => {
    const file = tempDbPath()
    legacyDb(file)
    initDatabase(file) // backup 1
    closeDatabase()

    // Force more upgrades by rewinding the version each time.
    for (let i = 0; i < 4; i++) {
      const d = new Database(file)
      d.pragma('user_version = 0')
      d.close()
      initDatabase(file)
      closeDatabase()
    }

    expect(backupsBeside(file).length).toBeLessThanOrEqual(3)
  })
})
