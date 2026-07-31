import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, X, ExternalLink, Copy, Check } from 'lucide-react'
import { useOutputStore } from '@/stores/outputStore'
import { cn } from '@/lib/utils'

const DISMISS_KEY = 'cb:ffmpeg-dismissed'

function wasDismissedThisSession(): boolean {
  try { return sessionStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

function dismissForSession() {
  try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
}

const WINGET_CMD = 'winget install --id Gyan.FFmpeg -e'
const CHOCO_CMD  = 'choco install ffmpeg'

export function FfmpegMissingModal() {
  const ffmpegAvailable = useOutputStore((s) => s.ffmpegAvailable)
  // Dismissing must not unmount the Dialog while it is open — Radix would then
  // skip its cleanup and leave aria-hidden stranded on the app root.
  const [open, setOpen]       = useState(() => !wasDismissedThisSession())
  const [copied, setCopied]   = useState<'winget' | 'choco' | null>(null)

  // Only show when explicitly false (null = still checking)
  if (ffmpegAvailable !== false) return null

  function handleDismiss() {
    dismissForSession()
    setOpen(false)
  }

  function copy(type: 'winget' | 'choco') {
    const text = type === 'winget' ? WINGET_CMD : CHOCO_CMD
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleDismiss() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[70] animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-[70] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[480px] bg-bg-panel border border-state-danger/40 rounded-panel shadow-modal',
            'flex flex-col animate-fade-in',
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-bg-divider">
            <AlertTriangle size={18} className="text-state-danger flex-shrink-0" />
            <Dialog.Title className="text-body font-semibold text-text-primary flex-1">
              FFmpeg Not Found
            </Dialog.Title>
            <button onClick={handleDismiss} className="icon-btn w-6 h-6">
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 flex flex-col gap-4">
            <p className="text-body text-text-secondary leading-relaxed">
              CodeBuilders requires <span className="text-text-primary font-medium">FFmpeg</span> for
              recording, streaming, replay buffer, and virtual camera. It was not found in your PATH.
            </p>

            <div className="bg-bg-base rounded-input p-3 flex flex-col gap-2">
              <p className="text-caption font-semibold text-text-muted uppercase tracking-wider">
                Install on Windows
              </p>

              {/* winget */}
              <div className="flex flex-col gap-1">
                <span className="text-caption text-text-muted">Using winget (recommended):</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-caption bg-bg-surface rounded px-2 py-1.5 text-text-primary font-mono truncate">
                    {WINGET_CMD}
                  </code>
                  <button
                    onClick={() => copy('winget')}
                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-state-hover transition-colors"
                    title="Copy command"
                  >
                    {copied === 'winget' ? <Check size={13} className="text-state-success" /> : <Copy size={13} />}
                  </button>
                </div>
              </div>

              {/* choco */}
              <div className="flex flex-col gap-1">
                <span className="text-caption text-text-muted">Using Chocolatey:</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-caption bg-bg-surface rounded px-2 py-1.5 text-text-primary font-mono truncate">
                    {CHOCO_CMD}
                  </code>
                  <button
                    onClick={() => copy('choco')}
                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-state-hover transition-colors"
                    title="Copy command"
                  >
                    {copied === 'choco' ? <Check size={13} className="text-state-success" /> : <Copy size={13} />}
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-text-muted opacity-60 mt-1 leading-relaxed">
                After installing, restart CodeBuilders. FFmpeg must be accessible via PATH.
              </p>
            </div>

            <a
              href="https://ffmpeg.org/download.html"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-caption text-accent-start hover:underline w-fit"
            >
              <ExternalLink size={12} />
              Download FFmpeg manually from ffmpeg.org
            </a>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-bg-divider">
            <button
              onClick={handleDismiss}
              className="h-7 px-4 rounded-button text-caption text-text-secondary
                         hover:text-text-primary hover:bg-state-hover transition-colors"
            >
              Dismiss
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
