import type { SnapshotChannel } from '../../shared/host'

/**
 * The audio that goes into every output: the channels the user has connected,
 * each at its own fader position and mute, summed into one stereo mix.
 *
 * The host opens its own inputs, because the interface's inputs feed its meters
 * and cannot be shared across windows. The mix therefore follows the snapshot:
 * a channel the interface has connected is opened here, one it has disconnected
 * is released, and volume and mute apply to what is recorded.
 *
 * The Web Audio pieces are injected so the rules can be tested without a browser.
 */

export interface GainLike {
  gain: { value: number; setTargetAtTime?(v: number, t: number, c: number): void }
  connect(to: unknown): void
  disconnect(): void
}

export interface SourceLike {
  connect(to: unknown): void
  disconnect(): void
}

export interface MixerDeps {
  /** Opens the input behind a channel, or rejects with a message worth showing. */
  openInput(channel: string, deviceId: string): Promise<MediaStream>
  createGain(): GainLike
  createSource(stream: MediaStream): SourceLike
}

interface Open {
  deviceId: string
  stream: MediaStream
  source: SourceLike
  gain: GainLike
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
    /** Where the mix goes. */
    private readonly destination: unknown,
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

    const source = this.deps.createSource(stream)
    const gain = this.deps.createGain()
    source.connect(gain)
    gain.connect(this.destination)

    this.open.set(id, { deviceId, stream, source, gain })
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
    input.gain.gain.value = want.muted ? 0 : volume
  }

  private release(id: string): void {
    const input = this.open.get(id)
    if (!input) return
    this.open.delete(id)

    try { input.source.disconnect() } catch { /* already gone */ }
    try { input.gain.disconnect() } catch { /* already gone */ }
    input.stream.getTracks().forEach((t) => t.stop())
  }
}
