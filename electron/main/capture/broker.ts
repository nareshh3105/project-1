/**
 * Decides what a screen-capture request is allowed to receive.
 *
 * Electron has no built-in picker for getDisplayMedia on Windows: with no
 * request handler installed the call fails with "NotSupportedError: Not
 * supported", so Display Capture and Window Capture sources could not capture
 * anything. The interface now shows its own picker, and this broker is how its
 * choice reaches the request handler.
 *
 * The flow is two steps: the renderer lists sources, the user picks one, the
 * renderer calls `prepare()` with that choice and immediately calls
 * getDisplayMedia, and the handler calls `resolve()` to find out what to grant.
 * A choice is used once and expires, so a page cannot capture the screen on
 * its own: with nothing prepared, every request is refused.
 */

export type CaptureKind = 'screen' | 'window'

/** What the interface needs to show a source in a picker. */
export interface CaptureSourceInfo {
  id: string
  name: string
  kind: CaptureKind
  /** PNG data URL, or null when the system could not produce one. */
  thumbnail: string | null
  /** The owning application's icon, for windows. */
  icon: string | null
}

/** The part of Electron's DesktopCapturerSource this module relies on. */
export interface RawSource {
  id: string
  name: string
  thumbnail: { isEmpty(): boolean; toDataURL(): string }
  appIcon: { isEmpty(): boolean; toDataURL(): string } | null
}

export type SourceLister = (kinds: CaptureKind[]) => Promise<RawSource[]>

export interface Grant {
  video: RawSource
  /** System audio, captured as loopback. */
  audio?: 'loopback'
}

interface Pending {
  sourceId: string
  audio: boolean
  expiresAt: number
}

/** How long a prepared choice stays valid. */
export const CHOICE_TTL_MS = 15_000

export const kindOf = (id: string): CaptureKind => (id.startsWith('screen:') ? 'screen' : 'window')

/** Whoever asks without saying who they are (tests, older callers). */
const ANONYMOUS = 0

export class CaptureBroker {
  /**
   * One choice waiting per window. The interface and the output host each open
   * captures, sometimes at the same moment, and a single shared slot let one's
   * choice be taken by the other's request.
   */
  private readonly pending = new Map<number, Pending>()

  constructor(
    private readonly list: SourceLister,
    private readonly now: () => number = Date.now,
  ) {}

  async listSources(kinds: CaptureKind[] = ['screen', 'window']): Promise<CaptureSourceInfo[]> {
    const raw = await this.list(kinds)

    return raw
      // A window with no title is a helper surface, not something a person
      // would pick, and it clutters the list.
      .filter((s) => kindOf(s.id) === 'screen' || s.name.trim().length > 0)
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: kindOf(s.id),
        thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      }))
  }

  /** Records the choice for the owner's next capture request. Replaces that owner's earlier one. */
  prepare(sourceId: string, audio = false, owner: number = ANONYMOUS): void {
    if (!sourceId) throw new Error('No capture source given')
    this.pending.set(owner, { sourceId, audio, expiresAt: this.now() + CHOICE_TTL_MS })
  }

  /**
   * What to grant the request that is being handled now, or null to refuse.
   * Consumes the prepared choice whether or not it can be honoured.
   */
  async resolve(owner: number = ANONYMOUS): Promise<Grant | null> {
    const choice = this.pending.get(owner)
    this.pending.delete(owner)

    if (!choice || choice.expiresAt < this.now()) return null

    const sources = await this.list([kindOf(choice.sourceId)])
    const video = sources.find((s) => s.id === choice.sourceId)
    // The window may have closed between picking it and capturing it.
    if (!video) return null

    return choice.audio ? { video, audio: 'loopback' } : { video }
  }
}
