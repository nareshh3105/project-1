import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Download, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { ipc, onUpdateDownloadProgress, type UpdateInfoPayload } from '@/ipc'
import { cn } from '@/lib/utils'

export function UpdaterModal() {
  const modal      = useUIStore((s) => s.modal)
  const closeModal = useUIStore((s) => s.closeModal)
  const isOpen = modal?.type === 'updater'

  const [checking,    setChecking]    = useState(false)
  const [updateInfo,  setUpdateInfo]  = useState<UpdateInfoPayload | null>(null)
  const [noUpdate,    setNoUpdate]    = useState(false)
  const [installing,  setInstalling]  = useState(false)
  const [installed,   setInstalled]   = useState(false)
  const [progress,    setProgress]    = useState<{ downloaded: number; total: number | null } | null>(null)
  const [error,       setError]       = useState<string | null>(null)

  // Auto-check when modal opens
  useEffect(() => {
    if (!isOpen) {
      setUpdateInfo(null)
      setNoUpdate(false)
      setInstalling(false)
      setInstalled(false)
      setProgress(null)
      setError(null)
      return
    }
    handleCheck()
  }, [isOpen])

  async function handleCheck() {
    setChecking(true)
    setError(null)
    setNoUpdate(false)
    setUpdateInfo(null)
    try {
      const info = await ipc.updater.check()
      if (info) {
        setUpdateInfo(info)
      } else {
        setNoUpdate(true)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setChecking(false)
    }
  }

  async function handleInstall() {
    setInstalling(true)
    setError(null)
    setProgress(null)

    const unlisten = await onUpdateDownloadProgress((p) => {
      setProgress({ downloaded: p.downloaded, total: p.total })
    })

    try {
      await ipc.updater.install()
      setInstalled(true)
    } catch (e) {
      setError(String(e))
    } finally {
      unlisten()
      setInstalling(false)
    }
  }

  const pct = progress && progress.total
    ? Math.round((progress.downloaded / progress.total) * 100)
    : null

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => !o && closeModal()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-50" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'w-[420px] bg-bg-surface rounded-modal shadow-modal border border-bg-divider',
            'flex flex-col focus:outline-none',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-bg-divider flex-shrink-0">
            <Dialog.Title className="text-body font-semibold text-text-primary">
              Software Update
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-state-hover">
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 min-h-[200px]">

            {checking && (
              <div className="flex flex-col items-center gap-3 text-text-secondary">
                <RefreshCw size={32} className="animate-spin text-accent-primary" />
                <p className="text-body">Checking for updates…</p>
              </div>
            )}

            {!checking && noUpdate && (
              <div className="flex flex-col items-center gap-3 text-text-secondary">
                <CheckCircle2 size={32} className="text-state-success" />
                <p className="text-body font-medium text-text-primary">You're up to date</p>
                <p className="text-caption text-text-muted">CodeBuilders is running the latest version.</p>
              </div>
            )}

            {!checking && updateInfo && !installed && (
              <div className="w-full flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Download size={18} className="text-accent-primary flex-shrink-0" />
                  <p className="text-body font-medium text-text-primary">
                    Version {updateInfo.version} available
                  </p>
                </div>

                {updateInfo.notes && (
                  <div className="bg-bg-panel rounded p-3 max-h-[120px] overflow-y-auto">
                    <p className="text-caption text-text-secondary whitespace-pre-wrap">{updateInfo.notes}</p>
                  </div>
                )}

                {installing && (
                  <div className="flex flex-col gap-1.5">
                    <div className="h-1.5 bg-bg-panel rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent-primary transition-all duration-300"
                        style={{ width: pct != null ? `${pct}%` : '100%' }}
                      />
                    </div>
                    <p className="text-caption text-text-muted text-center">
                      {pct != null ? `Downloading… ${pct}%` : 'Downloading…'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {installed && (
              <div className="flex flex-col items-center gap-3">
                <CheckCircle2 size={32} className="text-state-success" />
                <p className="text-body font-medium text-text-primary">Update installed</p>
                <p className="text-caption text-text-muted">Restart CodeBuilders to apply the update.</p>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 text-state-danger w-full">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <p className="text-caption leading-snug">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-bg-divider flex-shrink-0">
            {!checking && error && (
              <button
                onClick={handleCheck}
                className="h-7 px-3 text-caption rounded-button bg-bg-panel text-text-secondary hover:bg-state-hover"
              >
                Retry
              </button>
            )}

            {!checking && updateInfo && !installed && !installing && (
              <button
                onClick={handleInstall}
                className="h-7 px-3 text-caption rounded-button bg-accent-primary text-white hover:bg-accent-primary/90"
              >
                Install Now
              </button>
            )}

            <button
              onClick={closeModal}
              className="h-7 px-3 text-caption rounded-button bg-bg-panel text-text-secondary hover:bg-state-hover"
            >
              {installed ? 'Close' : 'Cancel'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
