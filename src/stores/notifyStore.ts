import { create } from 'zustand'
import { generateId } from '@/lib/utils'

/**
 * App-wide notices.
 *
 * Stores apply a change optimistically and then ask the backend to persist it.
 * Those backend calls used to sit inside empty catch blocks, so a failure left
 * the screen showing a scene, a rename or a source that was never saved, and
 * it vanished on the next launch with nothing to explain why. A failed write
 * now rolls its change back and lands here.
 */

export type NoticeKind = 'error' | 'info'

export interface Notice {
  id: string
  kind: NoticeKind
  message: string
}

interface NotifyState {
  notices: Notice[]
  notify: (kind: NoticeKind, message: string) => string
  dismiss: (id: string) => void
}

/** More than this stacked on screen is noise; the oldest give way. */
const MAX_VISIBLE = 4

export const useNotifyStore = create<NotifyState>((set, get) => ({
  notices: [],

  notify: (kind, message) => {
    // The same failure repeated (a retry loop, a stuck drag) should not stack
    // identical rows; keep the one already showing.
    const existing = get().notices.find((n) => n.kind === kind && n.message === message)
    if (existing) return existing.id

    const id = generateId()
    set((s) => ({ notices: [...s.notices, { id, kind, message }].slice(-MAX_VISIBLE) }))
    return id
  },

  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
}))

/** Reduces whatever a rejected backend call threw to something readable. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'unknown error'
}

/**
 * Reports a failed action: "Couldn't <action>: <reason>".
 * `action` is a verb phrase, e.g. "add the source".
 */
export function reportFailure(action: string, err: unknown): void {
  useNotifyStore.getState().notify('error', `Couldn't ${action}: ${describeError(err)}`)
}
