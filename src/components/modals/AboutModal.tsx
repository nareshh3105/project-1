import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { ipc } from '@/ipc'
import { cn } from '@/lib/utils'

const STACK = [
  { label: 'Framework',  value: 'Tauri 2 + React 18' },
  { label: 'Language',   value: 'TypeScript + Rust' },
  { label: 'UI',         value: 'Tailwind CSS + Radix UI' },
  { label: 'State',      value: 'Zustand + Immer' },
  { label: 'Database',   value: 'SQLite (sqlx)' },
  { label: 'Video',      value: 'FFmpeg' },
]

export function AboutModal() {
  const { modal, closeModal } = useUIStore((s) => ({ modal: s.modal, closeModal: s.closeModal }))
  const open = modal?.type === 'about'

  const [version,  setVersion]  = useState<string | null>(null)
  const [platform, setPlatform] = useState<{ os: string; arch: string } | null>(null)

  useEffect(() => {
    if (!open) return
    ipc.app.getVersion().then(setVersion).catch(() => setVersion('0.1.0'))
    ipc.app.getPlatform().then(setPlatform).catch(() => setPlatform({ os: 'Windows', arch: 'x86_64' }))
  }, [open])

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closeModal()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-50 animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[360px] bg-bg-panel border border-bg-divider rounded-panel shadow-modal',
            'flex flex-col animate-fade-in overflow-hidden',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-bg-divider">
            <Dialog.Title className="text-body font-semibold text-text-primary">About CodeBuilders</Dialog.Title>
            <button onClick={closeModal} className="icon-btn w-6 h-6"><X size={14} /></button>
          </div>

          {/* Body */}
          <div className="flex flex-col items-center gap-4 px-6 py-6">
            {/* App icon */}
            <div className="w-16 h-16 rounded-2xl bg-accent-gradient shadow-glow flex-shrink-0" />

            <div className="text-center">
              <h2 className="text-[17px] font-semibold text-text-primary">CodeBuilders</h2>
              <p className="text-caption text-text-muted mt-0.5">
                Version {version ?? '…'}
              </p>
              {platform && (
                <p className="text-[11px] text-text-muted opacity-60 mt-0.5">
                  {platform.os} · {platform.arch}
                </p>
              )}
            </div>

            <p className="text-caption text-text-secondary text-center leading-relaxed px-2">
              A professional screen recording and live streaming studio
              inspired by OBS Studio, built with modern web and systems technologies.
            </p>

            {/* Tech stack */}
            <div className="w-full bg-bg-base rounded-input divide-y divide-bg-divider/60 overflow-hidden">
              {STACK.map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-[11px] text-text-muted">{label}</span>
                  <span className="text-[11px] text-text-secondary font-medium">{value}</span>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-text-muted opacity-40 text-center">
              © {new Date().getFullYear()} CodeBuilders. All rights reserved.
            </p>
          </div>

          {/* Footer */}
          <div className="flex justify-end px-5 py-3 border-t border-bg-divider">
            <button
              onClick={closeModal}
              className="h-7 px-5 rounded-button text-caption font-medium text-white bg-accent-gradient hover:opacity-90 transition-opacity"
            >
              Close
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
