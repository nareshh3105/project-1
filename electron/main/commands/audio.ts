import { command, emit } from '../ipc'

const AUDIO_LEVELS_EVENT = 'audio:levels'
const METER_INTERVAL_MS = 50
const CHANNEL_ORDER = ['desktop', 'mic', 'browser', 'music'] as const

/**
 * NOTE: these levels are synthesised, not measured.
 *
 * The Rust implementation drove the meters from a sum of sinusoids rather than
 * from any capture device, and this is a faithful port of that behaviour so the
 * interface keeps working. Real per-channel metering is not implemented in
 * either build — the meters animate plausibly but reflect nothing.
 */
class Channel {
  phase: number
  envelope = 0
  volume = 1
  muted = false

  constructor(readonly baseDb: number, phase: number) {
    this.phase = phase
  }

  tick(): [number, number, number, number] {
    this.phase += 0.08

    const sig =
      Math.sin(this.phase * 1.7) +
      Math.sin(this.phase * 2.9) * 0.5 +
      Math.sin(this.phase * 5.1) * 0.25 +
      Math.sin(this.phase * 8.3) * 0.12
    const abs = Math.min(Math.abs(sig) / 1.87, 1)

    // Envelope follower: fast attack, slow release.
    this.envelope =
      abs > this.envelope
        ? abs * 0.8 + this.envelope * 0.2
        : abs * 0.03 + this.envelope * 0.97

    if (this.muted || this.volume < 0.001) return [-100, -100, -100, -100]

    const volDb = 20 * Math.log10(Math.max(this.volume, 0.001))
    const rmsDb = Math.min(
      0,
      Math.max(-60, 20 * Math.log10(Math.max(this.envelope, 0.0001)) + this.baseDb + volDb),
    )
    const peakDb = Math.min(0, rmsDb + 3)
    const stereo = Math.sin(this.phase * 0.8) * 1.2

    return [
      Math.min(0, peakDb + stereo),
      Math.min(0, peakDb - stereo),
      Math.min(0, rmsDb + stereo * 0.4),
      Math.min(0, rmsDb - stereo * 0.4),
    ]
  }
}

const channels = new Map<string, Channel>([
  ['desktop', new Channel(-18, 0)],
  ['mic', new Channel(-35, 1.2)],
  ['browser', new Channel(-22, 2.4)],
  ['music', new Channel(-12, 3.6)],
])

let timer: NodeJS.Timeout | null = null

export function registerAudioCommands() {
  command('start_audio', () => {
    if (timer) return
    timer = setInterval(() => {
      emit(
        AUDIO_LEVELS_EVENT,
        CHANNEL_ORDER.map((id) => {
          const [peakL, peakR, rmsL, rmsR] = channels.get(id)!.tick()
          return { id, peakL, peakR, rmsL, rmsR }
        }),
      )
    }, METER_INTERVAL_MS)
  })

  command('stop_audio', () => stopAudio())

  command('set_channel_volume', ({ id, volume }) => {
    const ch = channels.get(id as string)
    if (ch) ch.volume = Math.min(1, Math.max(0, Number(volume)))
  })

  command('set_channel_muted', ({ id, muted }) => {
    const ch = channels.get(id as string)
    if (ch) ch.muted = Boolean(muted)
  })

  // Preview frames are produced in the renderer via getDisplayMedia; these
  // exist so the interface's existing calls resolve rather than throw.
  command('start_preview', () => {})
  command('stop_preview', () => {})
}

export function stopAudio() {
  if (timer) clearInterval(timer)
  timer = null
}
