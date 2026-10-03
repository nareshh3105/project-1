import type { HostSnapshot, SessionParams, OutputKind } from '../../shared/host'
import type { SourceItem } from '@/stores/sourceStore'
import type { AudioChannel } from '@/stores/audioStore'
import type { SettingsState } from '@/stores/settingsStore'
import { parseCaptureTarget } from '@/lib/capture/target'

/**
 * What the output host needs from the interface, and what an output is asked
 * to produce. Pure, so the translation from the app's state is tested without
 * a window.
 */

interface SnapshotInput {
  /** The sources of the scene being output, in the interface's order: index 0 is the top layer. */
  sources: readonly SourceItem[]
  base: { width: number; height: number }
  channels: readonly AudioChannel[]
  connected: readonly string[]
}

export function buildSnapshot({ sources, base, channels, connected }: SnapshotInput): HostSnapshot {
  const visible = sources.filter((s) => s.visible)

  return {
    base: { width: base.width, height: base.height },
    // The interface lists the top layer first; the host draws the bottom first.
    sources: visible
      .map((s, i) => ({
        id: s.id,
        type: s.sourceType,
        order: visible.length - 1 - i,
        transform: { ...s.transform },
        target: parseCaptureTarget(s.settings),
      })),
    audio: channels.map((c) => ({
      id: c.id,
      volume: c.volume,
      muted: c.muted,
      noiseSuppression: c.noiseSuppression,
      connected: connected.includes(c.id),
    })),
  }
}

/** A bitrate that suits a resolution and frame rate, for when the user leaves it on automatic. */
export function suggestedVideoBitrate(width: number, height: number, fps: number): number {
  const raw = width * height * fps * 0.097
  return Math.round(Math.min(100_000_000, Math.max(1_000_000, raw)) / 100_000) * 100_000
}

/** The settings an output is started with. */
export function outputParams(
  settings: Pick<SettingsState, 'video' | 'recording'>,
  kind: OutputKind,
): SessionParams {
  const { video, recording } = settings
  const { width, height } = video.outputResolution
  const fps = video.fps

  return {
    width,
    height,
    fps,
    videoBitrate: recording.videoBitrateKbps > 0
      ? recording.videoBitrateKbps * 1000
      : suggestedVideoBitrate(width, height, fps),
    audioBitrate: recording.audioBitrateKbps * 1000,
    encoder: recording.encoder,
    keyframeSeconds: 2,
    audio: kind !== 'virtualCamera',
  }
}
