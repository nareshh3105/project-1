import {
  EMPTY_SNAPSHOT,
  type HostSnapshot, type SnapshotChannel, type SnapshotSource, type SnapshotTransform,
} from '../../../shared/host'

/**
 * Checks the scene and mixer state the interface sends to the host.
 *
 * It crosses a process boundary and ends up driving a canvas and an audio mixer,
 * so a malformed entry (a missing id, a NaN position, a zero scale that would
 * collapse a source to nothing) is repaired or dropped here rather than reaching
 * them. The interface is trusted to be well-behaved; it is not trusted to be
 * bug-free.
 */

const MAX_SOURCES = 200
const MAX_CHANNELS = 16

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const positive = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback

/** A scale of zero would make a source vanish; treat it as missing. */
const scale = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : 1

function transformOf(raw: unknown, base: { width: number; height: number }): SnapshotTransform {
  const t = isRecord(raw) ? raw : {}
  return {
    x: num(t.x, 0),
    y: num(t.y, 0),
    width: positive(t.width, base.width),
    height: positive(t.height, base.height),
    rotation: num(t.rotation, 0),
    scaleX: scale(t.scaleX),
    scaleY: scale(t.scaleY),
  }
}

const TARGET_KINDS = ['screen', 'window', 'camera']

function targetOf(raw: unknown): SnapshotSource['target'] {
  if (!isRecord(raw)) return null
  const { kind, id, name } = raw
  if (typeof kind !== 'string' || !TARGET_KINDS.includes(kind)) return null
  if (typeof id !== 'string' || id.length === 0) return null
  return { kind: kind as 'screen' | 'window' | 'camera', id, name: typeof name === 'string' ? name : '' }
}

const MAX_SETTINGS = 24
const MAX_STRING = 4000

/** Plain values only: whatever else a settings object holds is not the host's business. */
function settingsOf(raw: unknown): SnapshotSource['settings'] {
  if (!isRecord(raw)) return {}
  const out: SnapshotSource['settings'] = {}
  for (const [key, value] of Object.entries(raw).slice(0, MAX_SETTINGS)) {
    if (typeof value === 'string') out[key] = value.slice(0, MAX_STRING)
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    else if (typeof value === 'boolean') out[key] = value
  }
  return out
}

function sourceOf(raw: unknown, index: number, base: { width: number; height: number }): SnapshotSource | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  if (typeof raw.type !== 'string') return null

  return {
    id: raw.id,
    type: raw.type,
    order: num(raw.order, index),
    transform: transformOf(raw.transform, base),
    target: targetOf(raw.target),
    settings: settingsOf(raw.settings),
  }
}

function channelOf(raw: unknown): SnapshotChannel | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null

  return {
    id: raw.id,
    // A level outside 0 to 1 would amplify or invert the signal.
    volume: Math.min(1, Math.max(0, num(raw.volume, 1))),
    muted: raw.muted === true,
    noiseSuppression: raw.noiseSuppression === true,
    connected: raw.connected === true,
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId.slice(0, 512) : '',
  }
}

export function sanitizeSnapshot(raw: unknown): HostSnapshot {
  if (!isRecord(raw)) return EMPTY_SNAPSHOT

  const rawBase = isRecord(raw.base) ? raw.base : {}
  const base = {
    width: positive(rawBase.width, EMPTY_SNAPSHOT.base.width),
    height: positive(rawBase.height, EMPTY_SNAPSHOT.base.height),
  }

  const sources = (Array.isArray(raw.sources) ? raw.sources : [])
    .slice(0, MAX_SOURCES)
    .map((s, i) => sourceOf(s, i, base))
    .filter((s): s is SnapshotSource => s !== null)

  const audio = (Array.isArray(raw.audio) ? raw.audio : [])
    .slice(0, MAX_CHANNELS)
    .map(channelOf)
    .filter((c): c is SnapshotChannel => c !== null)

  return { base, sources, audio }
}
