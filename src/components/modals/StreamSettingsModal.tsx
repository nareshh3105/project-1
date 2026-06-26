import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Eye, EyeOff } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useOutputStore } from '@/stores/outputStore'
import { ipc } from '@/ipc'
import { cn } from '@/lib/utils'

export function StreamSettingsModal() {
  const { modal, closeModal } = useUIStore((s) => ({
    modal:      s.modal,
    closeModal: s.closeModal,
  }))
  const { stream, setStreamSettings, setStreamingStatus } = useOutputStore((s) => ({
    stream:               s.stream,
    setStreamSettings:    s.setStreamSettings,
    setStreamingStatus:   s.setStreamingStatus,
  }))

  const open = modal?.type === 'stream-settings'

  const [rtmpUrl,      setRtmpUrl]      = useState(stream.rtmpUrl)
  const [streamKey,    setStreamKey]    = useState(stream.streamKey)
  const [showKey,      setShowKey]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [starting,     setStarting]     = useState(false)

  // Sync inputs when modal opens
  useEffect(() => {
    if (open) {
      setRtmpUrl(stream.rtmpUrl)
      setStreamKey(stream.streamKey)
      setError(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGoLive() {
    const url = rtmpUrl.trim()
    if (!url) { setError('RTMP URL is required'); return }
    setError(null)
    setStarting(true)
    try {
      setStreamSettings(url, streamKey.trim())
      await ipc.output.startStreaming(url, streamKey.trim())
      closeModal()
    } catch (e) {
      setError(String(e))
    } finally {
      setStarting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closeModal()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[60] animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[400px] bg-bg-panel border border-bg-divider rounded-panel shadow-modal',
            'flex flex-col animate-fade-in',
          )}
          onKeyDown={(e) => { if (e.key === 'Escape') closeModal() }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-bg-divider">
            <Dialog.Title className="text-body font-semibold text-text-primary">
              Stream Settings
            </Dialog.Title>
            <button onClick={closeModal} className="icon-btn">
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-caption text-text-secondary font-medium">
                RTMP URL
              </label>
              <input
                type="text"
                placeholder="rtmp://live.twitch.tv/app"
                value={rtmpUrl}
                onChange={(e) => setRtmpUrl(e.target.value)}
                className="h-8 px-3 rounded-input bg-bg-surface border border-bg-divider
                           text-body text-text-primary focus:outline-none focus:border-accent-start"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-caption text-text-secondary font-medium">
                Stream Key
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  placeholder="••••••••••••••••"
                  value={streamKey}
                  onChange={(e) => setStreamKey(e.target.value)}
                  className="w-full h-8 px-3 pr-8 rounded-input bg-bg-surface border border-bg-divider
                             text-body text-text-primary focus:outline-none focus:border-accent-start"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                >
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>

            <p className="text-[11px] text-text-muted opacity-60 leading-relaxed">
              Stream key is saved locally. ffmpeg must be installed and in PATH for streaming to work.
            </p>

            {error && (
              <p className="text-caption text-state-danger bg-state-danger/10 px-3 py-2 rounded-input">
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-bg-divider">
            <button
              onClick={closeModal}
              className="h-7 px-4 rounded-button text-caption text-text-secondary
                         hover:text-text-primary hover:bg-state-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleGoLive}
              disabled={starting}
              className="h-7 px-5 rounded-button text-caption font-semibold text-white
                         bg-state-danger hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {starting ? 'Starting…' : 'Go Live'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
