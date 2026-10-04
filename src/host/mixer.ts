import type { SnapshotChannel } from '../../shared/host'

/**
 * Which inputs the mix has open, and at what level.
 *
 * The host opens its own inputs, because the interface's inputs feed its meters
 * and cannot be shared across windows. They follow the snapshot: a channel the
 * interface has connected is opened here, one it has disconnected is released,
 * a different microphone is switched to, and volume and mute apply to what is
 * recorded. Where the sound goes from there is `attach`'s business.
 *
 * Everything the browser does is injected so the rules can be tested without one.
 */

/** What an attached input offers the mix. */
export interface InputControl {
  setGain(gain: number): void
  /** Stops feeding the mix. */
  detach(): void
}

export interface MixerDeps {
  /** Opens the input behind a channel, or rejects with a message worth showing. */
  openInput(channel: string, deviceId: string): Promise<MediaStream>
  /** Starts feeding a stream into the mix under this channel name. */
  attach(channel: string, stream: MediaStream): InputControl
}

interface Open {
  deviceId: string
  stream: MediaStream
  control: InputControl
}

/** Channels that have an input to open; the others are placeholders in the mixer. */
const OPENABLE = new Set(['mic', 'desktop'])

export class Mixer {
  private readonly open = new Map<string, Open>()
  /** Channels being opened right now, so a second snapshot does not open them twice. */
  private readonly opening = new Map<string, { ticket: symbol; deviceId: string }>()
  private readonly failures = new Map<string, { message: string; deviceId: string }>()
  private last = new Map<string, SnapshotChannel>()

  constructor(
    private readonly deps: MixerDeps,
    private readonly onChange: () => void = () => {},
  ) {}

  /** Brings the inputs and levels in line with the interface. */
  apply(channels: readonly SnapshotChannel[]): void {
    // A channel with no device named uses the system default.
    this.last = new Map(channels.map((c) => [c.id, { ...c, deviceId: c.deviceId ?? '' }]))

    for (const id of [...this.open.keys()]) {
      const want = this.last.get(id)
      // A different device is chosen: let go of the old one and open the new.
      if (!want || !want.connected || want.deviceId !== this.open.get(id)!.deviceId) this.release(id)
    }
    for (const [id, ticket] of [...this.opening]) {
      const want = this.last.get(id)
      if (!want || !want.connected || want.deviceId !== ticket.deviceId) this.opening.delete(id)
    }
    // Reconnecting, or choosing another device, is how the user asks for another try.
    for (const [id, failure] of [...this.failures]) {
      const want = this.last.get(id)
      if (!want || !want.connected || want.deviceId !== failure.deviceId) this.failures.delete(id)
    }

    for (const ch of channels) {
      if (!ch.connected || !OPENABLE.has(ch.id)) continue
      // A failed input is not retried on every snapshot; snapshots arrive with every drag.
      if (this.failures.has(ch.id)) continue
      if (this.open.has(ch.id) || this.opening.has(ch.id)) {
        this.setLevel(ch.id)
        continue
      }
      void this.openChannel(ch.id)
    }
  }

  /** Channels that could not be opened, and why. */
  errors(): Record<string, string> {
    return Object.fromEntries([...this.failures].map(([id, f]) => [id, f.message]))
  }

  get openChannels(): string[] {
    return [...this.open.keys()]
  }

  /** Releases every input. */
  dispose(): void {
    for (const id of [...this.open.keys()]) this.release(id)
    this.opening.clear()
  }

  // ── internals ──

  private async openChannel(id: string): Promise<void> {
    const deviceId = this.last.get(id)?.deviceId ?? ''
    const mine = { ticket: Symbol(id), deviceId }
    this.opening.set(id, mine)
    this.failures.delete(id)

    let stream: MediaStream
    try {
      stream = await this.deps.openInput(id, deviceId)
    } catch (err) {
      if (this.opening.get(id) === mine) {
        this.opening.delete(id)
        this.failures.set(id, { deviceId, message: err instanceof Error && err.message ? err.message : 'Could not open the input.' })
        this.onChange()
      }
      return
    }

    // Disconnected, changed to another device, or the mixer disposed, while the input was opening.
    if (this.opening.get(id) !== mine) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    this.opening.delete(id)

    const control = this.deps.attach(id, stream)
    this.open.set(id, { deviceId, stream, control })
    this.setLevel(id)

    // A device unplugged, or sharing stopped: the channel goes quiet, and says why.
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (this.open.get(id)?.stream !== stream) return
        this.release(id)
        this.failures.set(id, { deviceId, message: 'The input was disconnected.' })
        this.onChange()
      })
    }
    this.onChange()
  }

  private setLevel(id: string): void {
    const input = this.open.get(id)
    const want = this.last.get(id)
    if (!input || !want) return

    const volume = Number.isFinite(want.volume) ? Math.min(1, Math.max(0, want.volume)) : 0
    input.control.setGain(want.muted ? 0 : volume)
  }

  private release(id: string): void {
    const input = this.open.get(id)
    if (!input) return
    this.open.delete(id)

    try { input.control.detach() } catch { /* already gone */ }
    input.stream.getTracks().forEach((t) => t.stop())
  }
}
