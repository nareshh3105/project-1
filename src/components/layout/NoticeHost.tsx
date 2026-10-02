import { useEffect } from 'react'
import { X, AlertCircle, Info } from 'lucide-react'
import { useNotifyStore, type Notice } from '@/stores/notifyStore'
import { cn } from '@/lib/utils'

/** Errors stay long enough to read and act on; information goes sooner. */
const LIFETIME_MS: Record<Notice['kind'], number> = {
  error: 8000,
  info: 4000,
}

/**
 * Renders the app-wide notices from the notify store.
 *
 * Sits above the modals (z-[90]) because a failure raised from inside a dialog,
 * such as a rename, is exactly when the user needs to see it.
 */
export function NoticeHost() {
  const notices = useNotifyStore((s) => s.notices)

  if (notices.length === 0) return null

  return (
    <div
      className="fixed bottom-8 right-4 z-[90] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)]"
      // Errors are announced immediately; the container itself is not a live
      // region so a stack of notices is not re-read whenever one is added.
    >
      {notices.map((n) => (
        <NoticeRow key={n.id} notice={n} />
      ))}
    </div>
  )
}

function NoticeRow({ notice }: { notice: Notice }) {
  const dismiss = useNotifyStore((s) => s.dismiss)

  // One timer per notice, tied to its own row so removing it (or the whole
  // host) cancels it. The store dedupes repeats, so a repeated failure keeps
  // the countdown it already had rather than restarting it.
  useEffect(() => {
    const timer = setTimeout(() => dismiss(notice.id), LIFETIME_MS[notice.kind])
    return () => clearTimeout(timer)
  }, [notice.id, notice.kind, dismiss])

  const isError = notice.kind === 'error'

  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-panel border px-3 py-2.5 shadow-modal animate-fade-in',
        'bg-bg-panel',
        isError ? 'border-state-danger/50' : 'border-bg-divider',
      )}
    >
      {isError ? (
        <AlertCircle size={14} className="text-state-danger flex-shrink-0 mt-px" />
      ) : (
        <Info size={14} className="text-accent-start flex-shrink-0 mt-px" />
      )}
      <p className="flex-1 text-caption text-text-primary leading-snug break-words">{notice.message}</p>
      <button
        type="button"
        onClick={() => dismiss(notice.id)}
        aria-label="Dismiss"
        className="icon-btn w-5 h-5 flex-shrink-0"
      >
        <X size={12} />
      </button>
    </div>
  )
}
