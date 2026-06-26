import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  X, Puzzle, FolderOpen, RefreshCw, Trash2,
  AlertCircle, Loader2, ToggleLeft, ToggleRight,
} from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { usePluginStore } from '@/stores/pluginStore'
import type { PluginItem } from '@/stores/pluginStore'
import { ConfirmModal } from './ConfirmModal'
import { cn } from '@/lib/utils'

export function PluginsModal() {
  const modal      = useUIStore((s) => s.modal)
  const closeModal = useUIStore((s) => s.closeModal)
  const isOpen = modal?.type === 'plugins'

  const {
    plugins, loading, error,
    loadPlugins, discoverPlugins,
    enablePlugin, disablePlugin,
    uninstallPlugin, openPluginsFolder, getPluginsFolder,
  } = usePluginStore()

  const [deleteTarget, setDeleteTarget] = useState<PluginItem | null>(null)
  const [folder, setFolder] = useState('')

  useEffect(() => {
    if (!isOpen) return
    loadPlugins()
    getPluginsFolder().then(setFolder).catch(() => {})
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Dialog.Root open={isOpen} onOpenChange={(open) => !open && closeModal()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
          <Dialog.Content
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
              w-[560px] max-h-[560px] flex flex-col bg-bg-surface
              rounded-[12px] border border-bg-divider shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-bg-divider flex-shrink-0">
              <Dialog.Title className="text-body font-semibold text-text-primary">
                Plugins
              </Dialog.Title>
              <button onClick={closeModal} className="icon-btn">
                <X size={14} />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {loading && plugins.length === 0 ? (
                <div className="flex items-center justify-center h-32 gap-2 text-text-muted">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-caption">Loading plugins…</span>
                </div>
              ) : plugins.length === 0 ? (
                <EmptyState folder={folder} />
              ) : (
                plugins.map((p) => (
                  <PluginRow
                    key={p.id}
                    plugin={p}
                    onEnable={()      => enablePlugin(p.id)}
                    onDisable={()     => disablePlugin(p.id)}
                    onUninstall={() => setDeleteTarget(p)}
                  />
                ))
              )}
            </div>

            {/* Error banner */}
            {error && (
              <div className="px-4 py-2 bg-state-danger/10 border-t border-state-danger/20 flex items-center gap-2 flex-shrink-0">
                <AlertCircle size={12} className="text-state-danger flex-shrink-0" />
                <span className="text-caption text-state-danger truncate">{error}</span>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center gap-1.5 px-3 py-2.5 border-t border-bg-divider flex-shrink-0">
              <button
                onClick={() => discoverPlugins()}
                disabled={loading}
                className="flex items-center gap-1.5 px-2.5 h-7 rounded text-caption text-text-secondary
                  hover:text-text-primary hover:bg-state-hover transition-colors disabled:opacity-40"
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                Discover
              </button>
              <button
                onClick={() => openPluginsFolder()}
                className="flex items-center gap-1.5 px-2.5 h-7 rounded text-caption text-text-secondary
                  hover:text-text-primary hover:bg-state-hover transition-colors"
              >
                <FolderOpen size={12} />
                Open Folder
              </button>
              <div className="flex-1" />
              <button
                onClick={closeModal}
                className="h-7 px-4 rounded-[6px] text-caption font-medium bg-bg-panel text-text-secondary
                  hover:bg-state-hover hover:text-text-primary transition-colors"
              >
                Close
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmModal
        open={!!deleteTarget}
        title="Uninstall Plugin"
        message={`Remove "${deleteTarget?.name}" from the plugin registry? Plugin files stay on disk.`}
        confirmLabel="Uninstall"
        danger
        onConfirm={() => deleteTarget && uninstallPlugin(deleteTarget.id)}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────

function EmptyState({ folder }: { folder: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-44 gap-3 px-6 text-center">
      <Puzzle size={24} className="text-text-muted opacity-30" />
      <p className="text-caption text-text-muted">
        No plugins installed.
        <br />
        Drop a plugin folder into the plugins directory, then click <strong>Discover</strong>.
      </p>
      {folder && (
        <p className="text-[10px] text-text-muted opacity-50 font-mono break-all max-w-full">
          {folder}
        </p>
      )}
    </div>
  )
}

// ── Plugin row ────────────────────────────────────────────────────────────

function PluginRow({
  plugin, onEnable, onDisable, onUninstall,
}: {
  plugin: PluginItem
  onEnable:    () => void
  onDisable:   () => void
  onUninstall: () => void
}) {
  const isEnabled = plugin.state === 'enabled'
  const isLoading = plugin.state === 'loading'
  const isError   = plugin.state === 'error'

  const manifest = (() => {
    try { return JSON.parse(plugin.manifest) as Record<string, unknown> }
    catch { return null }
  })()

  const permissions = Array.isArray(manifest?.permissions)
    ? (manifest.permissions as string[])
    : []

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-bg-divider group hover:bg-state-hover/50 transition-colors">
      {/* Icon */}
      <div className={cn(
        'w-8 h-8 rounded-[6px] flex items-center justify-center flex-shrink-0 mt-0.5',
        isError ? 'bg-state-danger/15' : 'bg-bg-panel',
      )}>
        {isError
          ? <AlertCircle size={14} className="text-state-danger" />
          : <Puzzle size={14} className="text-text-muted" />
        }
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-body font-medium text-text-primary">{plugin.name}</span>
          <span className="text-[10px] text-text-muted bg-bg-panel px-1.5 py-0.5 rounded font-mono">
            v{plugin.version}
          </span>
          <PhaseBadge phase={plugin.phase} />
          <StateBadge state={plugin.state} />
        </div>

        {!!manifest?.description && (
          <p className="text-caption text-text-muted mt-0.5 truncate">
            {String(manifest.description)}
          </p>
        )}
        {!!manifest?.author && (
          <p className="text-[10px] text-text-muted opacity-50 mt-0.5">
            by {String(manifest.author)}
          </p>
        )}
        {isError && plugin.errorMessage && (
          <p className="text-[10px] text-state-danger mt-1 break-words line-clamp-2">
            {plugin.errorMessage}
          </p>
        )}
        {permissions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {permissions.map((perm) => (
              <span
                key={perm}
                className="text-[9px] text-text-muted bg-bg-base px-1.5 py-0.5 rounded border border-bg-divider font-mono"
              >
                {perm}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
        {isLoading ? (
          <div className="w-7 h-7 flex items-center justify-center">
            <Loader2 size={14} className="animate-spin text-text-muted" />
          </div>
        ) : (
          <button
            onClick={isEnabled ? onDisable : onEnable}
            title={isEnabled ? 'Disable plugin' : 'Enable plugin'}
            className="w-7 h-7 flex items-center justify-center rounded transition-colors
              text-text-muted hover:text-text-primary hover:bg-state-hover"
          >
            {isEnabled
              ? <ToggleRight size={18} className="text-accent-start" />
              : <ToggleLeft size={18} />
            }
          </button>
        )}
        <button
          onClick={onUninstall}
          title="Uninstall plugin"
          className="w-7 h-7 flex items-center justify-center rounded transition-colors
            text-text-muted hover:text-state-danger hover:bg-state-danger/10
            opacity-0 group-hover:opacity-100"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Badges ────────────────────────────────────────────────────────────────

function PhaseBadge({ phase }: { phase: string }) {
  const isJs = phase === 'js_sandbox'
  return (
    <span className={cn(
      'text-[9px] px-1.5 py-0.5 rounded border font-mono uppercase tracking-wide',
      isJs
        ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
        : 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    )}>
      {isJs ? 'JS' : 'Native'}
    </span>
  )
}

function StateBadge({ state }: { state: string }) {
  if (state === 'disabled') return null
  const map: Record<string, string> = {
    enabled: 'bg-green-500/10 text-green-400 border-green-500/20',
    loading: 'bg-blue-500/10  text-blue-400  border-blue-500/20',
    error:   'bg-red-500/10   text-red-400   border-red-500/20',
  }
  const labels: Record<string, string> = { enabled: 'active', loading: 'loading', error: 'error' }
  return (
    <span className={cn('text-[9px] px-1.5 py-0.5 rounded border font-mono', map[state] ?? '')}>
      {labels[state] ?? state}
    </span>
  )
}
