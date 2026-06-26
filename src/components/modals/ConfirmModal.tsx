import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmModal({
  open, title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onClose,
}: ConfirmModalProps) {
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
        >
          <div className="flex items-center gap-3">
            {danger && <AlertTriangle size={16} className="text-state-danger flex-shrink-0" />}
            <Dialog.Title className="text-body font-medium text-text-primary">
              {title}
            </Dialog.Title>
          </div>

          <p className="text-caption text-text-secondary leading-relaxed">{message}</p>

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="h-7 px-3 rounded-button text-caption text-text-muted hover:text-text-primary hover:bg-state-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { onConfirm(); onClose() }}
              className={cn(
                'h-7 px-3 rounded-button text-caption font-medium text-white transition-opacity hover:opacity-90',
                danger ? 'bg-state-danger' : 'bg-accent-gradient'
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
