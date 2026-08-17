import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Plugin discovery reads untrusted JSON off disk. Beyond the happy path, two
 * behaviours matter: one malformed manifest must not hide every other plugin,
 * and a manifest must not be able to reach outside the plugins directory.
 */

let userData: string
let pluginsDir: string
let invoke: (name: string, args?: Record<string, unknown>) => Promise<unknown>
let closeDatabase: () => void

interface PluginDto {
  id: string; name: string; version: string; state: string; configPath: string
}

beforeEach(async () => {
  vi.resetModules()

  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-plugins-'))
  pluginsDir = path.join(userData, 'plugins')

  const { app } = await import('electron')
  ;(app.getPath as ReturnType<typeof vi.fn>).mockImplementation(() => userData)

  const db = await import('../../electron/main/db')
  const ipc = await import('../../electron/main/ipc')
  const plugins = await import('../../electron/main/commands/plugins')

  db.initDatabase(path.join(userData, 'codebuilders.db'))
  plugins.registerPluginCommands()
  ipc.installDispatcher()

  const { ipcMain } = await import('electron')
  const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]

  invoke = (name, args = {}) => handler({}, name, args)
  closeDatabase = db.closeDatabase
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(userData, { recursive: true, force: true })
})

function writePlugin(dir: string, manifest: unknown, script = 'export function activate() {}') {
  const full = path.join(pluginsDir, dir)
  fs.mkdirSync(full, { recursive: true })
  fs.writeFileSync(
    path.join(full, 'plugin.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    'utf8',
  )
  fs.writeFileSync(path.join(full, 'index.js'), script, 'utf8')
  return full
}

const validManifest = (id: string) => ({
  id, name: `Plugin ${id}`, version: '2.1.0', phase: 'js_sandbox', entryPoint: 'index.js',
})

describe('discover_plugins', () => {
  it('creates the plugins directory and a sample plugin on first run', async () => {
    await invoke('discover_plugins')
    expect(fs.existsSync(path.join(pluginsDir, 'hello-world'))).toBe(true)
  })

  it('registers a plugin found on disk', async () => {
    writePlugin('my-plugin', validManifest('my-plugin'))
    const found = (await invoke('discover_plugins')) as PluginDto[]

    expect(found.map((p) => p.id)).toContain('my-plugin')
  })

  it('reads name and version from the manifest', async () => {
    writePlugin('my-plugin', validManifest('my-plugin'))
    const found = (await invoke('discover_plugins')) as PluginDto[]
    const mine = found.find((p) => p.id === 'my-plugin')!

    expect(mine.name).toBe('Plugin my-plugin')
    expect(mine.version).toBe('2.1.0')
  })

  it('registers plugins disabled, so nothing runs unasked', async () => {
    writePlugin('my-plugin', validManifest('my-plugin'))
    const found = (await invoke('discover_plugins')) as PluginDto[]

    expect(found.every((p) => p.state === 'disabled')).toBe(true)
  })

  it('skips a directory without a manifest', async () => {
    fs.mkdirSync(path.join(pluginsDir, 'not-a-plugin'), { recursive: true })
    const found = (await invoke('discover_plugins')) as PluginDto[]

    expect(found.map((p) => p.id)).not.toContain('not-a-plugin')
  })

  // One bad plugin must not take the whole list down with it.
  it('skips malformed JSON and still returns the others', async () => {
    writePlugin('broken', '{ this is not json')
    writePlugin('good', validManifest('good'))

    const found = (await invoke('discover_plugins')) as PluginDto[]

    expect(found.map((p) => p.id)).toContain('good')
    expect(found.map((p) => p.id)).not.toContain('broken')
  })

  it('skips a manifest missing its id', async () => {
    writePlugin('anon', { name: 'No identifier' })
    const found = (await invoke('discover_plugins')) as PluginDto[]

    expect(found.some((p) => p.name === 'No identifier')).toBe(false)
  })

  it('updates an existing record rather than duplicating it', async () => {
    writePlugin('my-plugin', validManifest('my-plugin'))
    await invoke('discover_plugins')

    writePlugin('my-plugin', { ...validManifest('my-plugin'), version: '3.0.0' })
    const found = (await invoke('discover_plugins')) as PluginDto[]

    const matches = found.filter((p) => p.id === 'my-plugin')
    expect(matches).toHaveLength(1)
    expect(matches[0].version).toBe('3.0.0')
  })
})

describe('enable and disable', () => {
  beforeEach(async () => {
    writePlugin('my-plugin', validManifest('my-plugin'))
    await invoke('discover_plugins')
  })

  const state = async () =>
    ((await invoke('list_plugins')) as PluginDto[]).find((p) => p.id === 'my-plugin')!.state

  it('enables a plugin', async () => {
    await invoke('enable_plugin', { id: 'my-plugin' })
    expect(await state()).toBe('enabled')
  })

  it('disables it again', async () => {
    await invoke('enable_plugin', { id: 'my-plugin' })
    await invoke('disable_plugin', { id: 'my-plugin' })
    expect(await state()).toBe('disabled')
  })
})

describe('uninstall_plugin', () => {
  it('removes the record and the directory', async () => {
    const dir = writePlugin('my-plugin', validManifest('my-plugin'))
    await invoke('discover_plugins')

    await invoke('uninstall_plugin', { id: 'my-plugin' })

    const remaining = (await invoke('list_plugins')) as PluginDto[]
    expect(remaining.map((p) => p.id)).not.toContain('my-plugin')
    expect(fs.existsSync(dir)).toBe(false)
  })

  // config_path comes from the database, so a corrupted or tampered row must
  // not be able to delete something elsewhere on the filesystem.
  it('does not delete a directory outside the plugins folder', async () => {
    writePlugin('my-plugin', validManifest('my-plugin'))
    await invoke('discover_plugins')

    const outside = path.join(userData, 'important')
    fs.mkdirSync(outside, { recursive: true })
    fs.writeFileSync(path.join(outside, 'data.txt'), 'keep me', 'utf8')

    const { getDb } = await import('../../electron/main/db')
    getDb()
      .prepare(`UPDATE plugins SET config_path = ? WHERE id = ?`)
      .run(outside, 'my-plugin')

    await invoke('uninstall_plugin', { id: 'my-plugin' })

    expect(fs.existsSync(path.join(outside, 'data.txt'))).toBe(true)
  })
})

describe('read_plugin_script', () => {
  it('returns the entry point contents', async () => {
    writePlugin('my-plugin', validManifest('my-plugin'), '// hello')
    await invoke('discover_plugins')

    expect(await invoke('read_plugin_script', { id: 'my-plugin' })).toBe('// hello')
  })

  it('rejects an unknown plugin', async () => {
    await expect(invoke('read_plugin_script', { id: 'nope' })).rejects.toMatch(
      /not found/i,
    )
  })

  // entryPoint is attacker-controlled text from a downloaded manifest.
  it('refuses an entry point that escapes the plugins folder', async () => {
    fs.writeFileSync(path.join(userData, 'secret.txt'), 'sensitive', 'utf8')
    writePlugin('evil', { ...validManifest('evil'), entryPoint: '../../secret.txt' })
    await invoke('discover_plugins')

    await expect(invoke('read_plugin_script', { id: 'evil' })).rejects.toMatch(
      /outside the plugins folder/i,
    )
  })

  it('falls back to index.js when the manifest omits an entry point', async () => {
    const manifest = validManifest('my-plugin') as Record<string, unknown>
    delete manifest.entryPoint
    writePlugin('my-plugin', manifest, '// default entry')
    await invoke('discover_plugins')

    expect(await invoke('read_plugin_script', { id: 'my-plugin' })).toBe('// default entry')
  })
})

describe('get_plugins_folder', () => {
  it('returns the path and creates it if absent', async () => {
    const dir = (await invoke('get_plugins_folder')) as string
    expect(dir).toBe(pluginsDir)
    expect(fs.existsSync(dir)).toBe(true)
  })
})
