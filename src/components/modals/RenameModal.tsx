import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'

interface RenameModalProps {
  open: boolean
  title: string
  current: string
  confirmLabel?: string
  onConfirm: (name: string) => void
  onClose: () => void
}

export function RenameModal({ open, title, current, confirmLabel = 'Rename', onConfirm, onClose }: RenameModalProps) {
  const [value, setValue] = useState(current)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue(current)
      setTimeout(() => inputRef.current?.select(), 50)
    }
  }, [open, current])

  function submit() {
    const trimmed = value.trim()
    if (trimmed && trimmed !== current) onConfirm(trimmed)
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50 animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-80 bg-bg-panel border border-bg-divider rounded-panel shadow-modal',
            'p-5 flex flex-col gap-4 animate-fade-in'
          )}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        >
          <Dialog.Title className="text-body font-medium text-text-primary">
            {title}
          </Dialog.Title>

          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={cn(
              'w-full h-8 px-2 rounded-input bg-bg-surface border border-bg-divider',
              'text-body text-text-primary selectable',
              'focus:outline-none focus:border-accent-start focus:shadow-glow',
              'transition-colors'
            )}
          />

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="h-7 px-3 rounded-button text-caption text-text-muted hover:text-text-primary hover:bg-state-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              className="h-7 px-3 rounded-button text-caption font-medium text-white bg-accent-gradient hover:opacity-90 transition-opacity"
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
