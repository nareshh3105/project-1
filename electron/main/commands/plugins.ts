import { app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { command } from '../ipc'
import { getDb, now } from '../db'

interface PluginRow {
  id: string
  name: string
  version: string
  phase: string
  state: string
  manifest: string
  config_path: string
  installed_at: number
  updated_at: number
}

const toPlugin = (r: PluginRow) => ({
  id: r.id,
  name: r.name,
  version: r.version,
  phase: r.phase,
  state: r.state,
  manifest: r.manifest,
  configPath: r.config_path,
  installedAt: r.installed_at,
  updatedAt: r.updated_at,
})

const pluginsDir = () => path.join(app.getPath('userData'), 'plugins')

const SAMPLE_MANIFEST = {
  id: 'hello-world',
  name: 'Hello World',
  version: '1.0.0',
  author: 'CodeBuilders',
  description: 'Sample plugin — logs a greeting every 5 seconds.',
  phase: 'js_sandbox',
  entryPoint: 'index.js',
  permissions: [],
}

const SAMPLE_SCRIPT = `// Sample CodeBuilders plugin.
// Runs in an isolated context with no filesystem access.
export function activate(ctx) {
  ctx.log('Hello from the hello-world plugin')
}
`

function ensureSamplePlugin(dir: string) {
  const sample = path.join(dir, 'hello-world')
  if (fs.existsSync(sample)) return
  fs.mkdirSync(sample, { recursive: true })
  fs.writeFileSync(
    path.join(sample, 'plugin.json'),
    JSON.stringify(SAMPLE_MANIFEST, null, 2),
    'utf8',
  )
  fs.writeFileSync(path.join(sample, 'index.js'), SAMPLE_SCRIPT, 'utf8')
}

/**
 * Scans the plugins directory and reconciles it with the database. A manifest
 * that fails to parse is skipped rather than aborting the scan, so one bad
 * plugin cannot hide every other.
 */
function discover() {
  const dir = pluginsDir()
  fs.mkdirSync(dir, { recursive: true })
  ensureSamplePlugin(dir)

  const db = getDb()
  const upsert = db.prepare(
    `INSERT INTO plugins (id, name, version, phase, state, manifest, config_path, installed_at, updated_at)
     VALUES (@id, @name, @version, @phase, @state, @manifest, @config_path, @installed_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       version = excluded.version,
       phase = excluded.phase,
       manifest = excluded.manifest,
       config_path = excluded.config_path,
       updated_at = excluded.updated_at`,
  )

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const manifestPath = path.join(dir, entry.name, 'plugin.json')
    if (!fs.existsSync(manifestPath)) continue

    try {
      const raw = fs.readFileSync(manifestPath, 'utf8')
      const m = JSON.parse(raw)
      if (!m.id || !m.name) continue

      upsert.run({
        id: String(m.id),
        name: String(m.name),
        version: String(m.version ?? '0.0.0'),
        phase: String(m.phase ?? 'js_sandbox'),
        state: 'disabled',
        manifest: raw,
        config_path: path.join(dir, entry.name),
        installed_at: now(),
        updated_at: now(),
      })
    } catch (err) {
      console.warn(`[plugins] skipping ${entry.name}: ${(err as Error).message}`)
    }
  }

  return (db.prepare(`SELECT * FROM plugins ORDER BY name`).all() as PluginRow[])
    .map(toPlugin)
}

export function registerPluginCommands() {
  command('list_plugins', () =>
    (getDb().prepare(`SELECT * FROM plugins ORDER BY name`).all() as PluginRow[])
      .map(toPlugin),
  )

  command('discover_plugins', () => discover())

  command('enable_plugin', ({ id }) => {
    getDb()
      .prepare(`UPDATE plugins SET state = 'enabled', updated_at = ? WHERE id = ?`)
      .run(now(), id as string)
  })

  command('disable_plugin', ({ id }) => {
    getDb()
      .prepare(`UPDATE plugins SET state = 'disabled', updated_at = ? WHERE id = ?`)
      .run(now(), id as string)
  })

  command('uninstall_plugin', ({ id }) => {
    const db = getDb()
    const row = db
      .prepare(`SELECT config_path FROM plugins WHERE id = ?`)
      .get(id as string) as { config_path: string } | undefined

    db.prepare(`DELETE FROM plugins WHERE id = ?`).run(id as string)

    // Only remove directories inside the plugins folder — a corrupted
    // config_path must not be able to delete something elsewhere on disk.
    if (row?.config_path) {
      const root = pluginsDir()
      const target = path.resolve(row.config_path)
      if (target.startsWith(path.resolve(root) + path.sep)) {
        fs.rmSync(target, { recursive: true, force: true })
      }
    }
  })

  command('get_plugins_folder', () => {
    const dir = pluginsDir()
    fs.mkdirSync(dir, { recursive: true })
    return dir
  })

  command('open_plugins_folder', async () => {
    const dir = pluginsDir()
    fs.mkdirSync(dir, { recursive: true })
    const err = await shell.openPath(dir)
    if (err) throw new Error(err)
  })

  command('read_plugin_script', ({ id }) => {
    const row = getDb()
      .prepare(`SELECT config_path, manifest FROM plugins WHERE id = ?`)
      .get(id as string) as { config_path: string; manifest: string } | undefined
    if (!row) throw new Error('Plugin not found')

    let entry = 'index.js'
    try {
      entry = JSON.parse(row.manifest).entryPoint || entry
    } catch {
      /* fall back to index.js */
    }

    const root = path.resolve(pluginsDir())
    const file = path.resolve(row.config_path, entry)
    // Block a manifest entryPoint like "../../../secrets.txt" from escaping.
    if (!file.startsWith(root + path.sep)) {
      throw new Error('Plugin entry point resolves outside the plugins folder')
    }

    return fs.readFileSync(file, 'utf8')
  })
}
