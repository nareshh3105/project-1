import type { HostSnapshot, SessionParams, OutputKind, SnapshotFilter } from '../../shared/host'
import type { SourceFilter } from '@/stores/filterStore'
import type { SourceItem } from '@/stores/sourceStore'
import type { AudioChannel } from '@/stores/audioStore'
import type { SettingsState } from '@/stores/settingsStore'
import { parseCaptureTarget } from '@/lib/capture/target'
import { isStaticType } from '@/lib/sources/static'

/**
 * What the output host needs from the interface, and what an output is asked
 * to produce. Pure, so the translation from the app's state is tested without
 * a window.
 */

interface SnapshotInput {
  /** The sources of the scene being output, in any order; their orderIndex says where each sits. */
  sources: readonly SourceItem[]
  base: { width: number; height: number }
  channels: readonly AudioChannel[]
  connected: readonly string[]
  /** The device chosen for each channel, if not the system default. */
  devices?: Readonly<Record<string, string>>
  /** Filters by source id, in the order they were added. */
  filters?: Readonly<Record<string, readonly SourceFilter[]>>
}

export function buildSnapshot({ sources, base, channels, connected, devices = {}, filters = {} }: SnapshotInput): HostSnapshot {
  // The preview paints by orderIndex, lowest at the bottom. The recording has to
  // stack them the same way, whatever order the list happens to be held in.
  const visible = sources.filter((s) => s.visible).sort((a, b) => a.orderIndex - b.orderIndex)

  return {
    base: { width: base.width, height: base.height },
    sources: visible
      .map((s, i) => ({
        id: s.id,
        type: s.sourceType,
        order: i,
        transform: { ...s.transform },
        target: parseCaptureTarget(s.settings),
        settings: isStaticType(s.sourceType) ? plainValues(s.settings) : {},
        filters: (filters[s.id] ?? []).filter((f) => f.enabled).map(toSnapshotFilter),
      })),
    audio: channels.map((c) => ({
      id: c.id,
      volume: c.volume,
      muted: c.muted,
      noiseSuppression: c.noiseSuppression,
      connected: connected.includes(c.id),
      deviceId: devices[c.id] ?? '',
    })),
  }
}

/** A filter as the host takes it: the same fields without the editor's name and switch. */
export function toSnapshotFilter(f: SourceFilter): SnapshotFilter {
  const { name: _name, enabled: _enabled, ...rest } = f
  void _name; void _enabled
  return rest as SnapshotFilter
}

/** The strings, numbers and booleans in a settings object; the host draws from nothing else. */
function plainValues(settings: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(settings ?? {})) {
    if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      out[key] = value
    }
  }
  return out
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
