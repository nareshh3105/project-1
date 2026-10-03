import type { SourceType } from '@/types'

/**
 * What a capture source points at: which screen, which window, which camera.
 *
 * It is saved in the source's settings, so reopening the app can resume the
 * capture without asking again. The catch is that not every kind of id
 * survives a restart, which is why a target carries the name as well.
 */

export type CaptureTargetKind = 'screen' | 'window' | 'camera'

export interface CaptureTarget {
  kind: CaptureTargetKind
  id: string
  /** What the user picked, as they saw it. Used to find a window again. */
  name: string
}

/** Something that can currently be captured, as reported by the system. */
export interface LiveSource {
  id: string
  name: string
}

const KINDS: readonly CaptureTargetKind[] = ['screen', 'window', 'camera']

/** The kind of target a source type captures, or null if it is not a capture type. */
export function targetKindFor(type: SourceType): CaptureTargetKind | null {
  switch (type) {
    case 'display_capture': return 'screen'
    // Game capture would hook the game's renderer, which this app cannot do;
    // it captures the game's window instead.
    case 'window_capture':
    case 'game_capture':    return 'window'
    case 'dshow_video':     return 'camera'
    default:                return null
  }
}

/** Reads the saved target out of a source's settings, or null if absent or malformed. */
export function parseCaptureTarget(settings: Record<string, unknown> | undefined): CaptureTarget | null {
  const raw = settings?.capture
  if (!raw || typeof raw !== 'object') return null

  const { kind, id, name } = raw as Record<string, unknown>
  if (typeof kind !== 'string' || !KINDS.includes(kind as CaptureTargetKind)) return null
  if (typeof id !== 'string' || id.length === 0) return null

  return { kind: kind as CaptureTargetKind, id, name: typeof name === 'string' ? name : '' }
}

/** Settings with the target recorded, leaving everything else as it was. */
export function withCaptureTarget(
  settings: Record<string, unknown>,
  target: CaptureTarget,
): Record<string, unknown> {
  return { ...settings, capture: { kind: target.kind, id: target.id, name: target.name } }
}

/**
 * Finds what a saved target refers to among what is available now.
 *
 *  - Screens and cameras keep their id between runs, so only the id counts. If
 *    it is gone (a monitor was unplugged, a camera removed) there is no match:
 *    quietly capturing a different monitor would be worse than saying so.
 *  - A window gets a new id every time it is opened, so after a restart the id is
 *    stale. The id is tried first, in case nothing has restarted, then the title.
 */
export function resolveTarget(target: CaptureTarget, available: readonly LiveSource[]): LiveSource | null {
  const byId = available.find((s) => s.id === target.id)
  if (byId) return byId

  if (target.kind === 'window' && target.name) {
    return available.find((s) => s.name === target.name) ?? null
  }
  return null
}

/** How to describe a target that could not be found. */
export function missingMessage(target: CaptureTarget): string {
  const label = target.name || 'the selected source'
  switch (target.kind) {
    case 'window': return `"${label}" is not open.`
    case 'camera': return `The camera "${label}" is not connected.`
    default:       return `"${label}" is not available. It may have been disconnected.`
  }
}
