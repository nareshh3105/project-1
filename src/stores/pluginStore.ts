import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { ipc } from '@/ipc'
import type { PluginDto } from '@/ipc'

export type PluginItem = PluginDto & { errorMessage: string | null }

// Workers live outside Zustand (non-serializable)
const _workers = new Map<string, Worker>()

interface PluginStoreState {
  plugins: PluginItem[]
  loading: boolean
  error:   string | null
}

interface PluginStoreActions {
  loadPlugins:      () => Promise<void>
  discoverPlugins:  () => Promise<void>
  enablePlugin:     (id: string) => Promise<void>
  disablePlugin:    (id: string) => Promise<void>
  uninstallPlugin:  (id: string) => Promise<void>
  openPluginsFolder: () => Promise<void>
  getPluginsFolder: () => Promise<string>
}

function toItem(dto: PluginDto): PluginItem {
  return { ...dto, errorMessage: null }
}

export const usePluginStore = create<PluginStoreState & PluginStoreActions>()(
  immer((set, get) => ({
    plugins: [],
    loading: false,
    error:   null,

    loadPlugins: async () => {
      set((s) => { s.loading = true; s.error = null })
      try {
        const dtos = await ipc.plugin.list()
        set((s) => { s.plugins = dtos.map(toItem); s.loading = false })
      } catch (err) {
        set((s) => { s.error = String(err); s.loading = false })
      }
    },

    discoverPlugins: async () => {
      set((s) => { s.loading = true; s.error = null })
      try {
        const dtos = await ipc.plugin.discover()
        set((s) => { s.plugins = dtos.map(toItem); s.loading = false })
      } catch (err) {
        set((s) => { s.error = String(err); s.loading = false })
      }
    },

    enablePlugin: async (id) => {
      const plugin = get().plugins.find((p) => p.id === id)
      if (!plugin) return

      set((s) => {
        const p = s.plugins.find((p) => p.id === id)
        if (p) { p.state = 'loading'; p.errorMessage = null }
      })

      try {
        await ipc.plugin.enable(id)

        if (plugin.phase === 'js_sandbox') {
          const script = await ipc.plugin.readScript(id)
          const manifest = JSON.parse(plugin.manifest) as { permissions?: string[] }
          spawnWorker(id, script, manifest.permissions ?? [], set)
          return // spawnWorker sets state directly
        }

        set((s) => {
          const p = s.plugins.find((p) => p.id === id)
          if (p) p.state = 'enabled'
        })
      } catch (err) {
        await ipc.plugin.disable(id).catch(() => {})
        set((s) => {
          const p = s.plugins.find((p) => p.id === id)
          if (p) { p.state = 'error'; p.errorMessage = String(err) }
        })
      }
    },

    disablePlugin: async (id) => {
      terminateWorker(id)
      try {
        await ipc.plugin.disable(id)
      } catch { /* best-effort */ }
      set((s) => {
        const p = s.plugins.find((p) => p.id === id)
        if (p) { p.state = 'disabled'; p.errorMessage = null }
      })
    },

    uninstallPlugin: async (id) => {
      const p = get().plugins.find((pl) => pl.id === id)
      if (p?.state === 'enabled' || p?.state === 'loading') {
        terminateWorker(id)
      }
      await ipc.plugin.uninstall(id)
      set((s) => { s.plugins = s.plugins.filter((p) => p.id !== id) })
    },

    openPluginsFolder: async () => {
      await ipc.plugin.openFolder()
    },

    getPluginsFolder: async () => {
      return ipc.plugin.getFolder()
    },
  }))
)

// ── JS Sandbox worker helpers ─────────────────────────────────────────────

function spawnWorker(
  id: string,
  script: string,
  permissions: string[],
  set: (fn: (s: PluginStoreState) => void) => void,
) {
  terminateWorker(id)

  const bridge = `
const __id = ${JSON.stringify(id)};
const __perms = ${JSON.stringify(permissions)};

const CodeBuilders = {
  log: function(msg) {
    postMessage({ type: 'cb:log', pluginId: __id, msg: String(msg) });
  },
  hasPermission: function(perm) {
    return __perms.indexOf(perm) !== -1;
  },
  on: function(event, handler) {
    self.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'cb:event' && e.data.event === event) {
        handler(e.data.payload);
      }
    });
  },
};
`
  const fullScript = bridge + '\n;(function(){\n' + script + '\n})();'
  const blob = new Blob([fullScript], { type: 'application/javascript' })
  const url  = URL.createObjectURL(blob)
  const worker = new Worker(url, { type: 'classic' })
  URL.revokeObjectURL(url)

  worker.addEventListener('message', (e) => {
    if (e.data?.type === 'cb:log') {
      console.info(`[Plugin:${e.data.pluginId}]`, e.data.msg)
    }
  })

  worker.addEventListener('error', (e) => {
    set((s) => {
      const p = s.plugins.find((p) => p.id === id)
      if (p) { p.state = 'error'; p.errorMessage = e.message || 'Runtime error' }
    })
    _workers.delete(id)
  })

  _workers.set(id, worker)

  set((s) => {
    const p = s.plugins.find((p) => p.id === id)
    if (p) p.state = 'enabled'
  })
}

function terminateWorker(id: string) {
  const w = _workers.get(id)
  if (w) { w.terminate(); _workers.delete(id) }
}
