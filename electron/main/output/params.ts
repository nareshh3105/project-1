import type { SessionParams, EncoderPreference } from '../../../shared/host'

/**
 * Encoding parameters, as the interface sends them.
 *
 * They come across a process boundary and end up in an encoder configuration,
 * so they are checked and clamped here rather than trusted: a zero width or a
 * NaN bitrate would otherwise reach the encoder and fail with an unhelpful
 * message, or worse, produce a broken file.
 */

export const DEFAULT_PARAMS: SessionParams = {
  width: 1920,
  height: 1080,
  fps: 30,
  videoBitrate: 6_000_000,
  audioBitrate: 160_000,
  encoder: 'auto',
  keyframeSeconds: 2,
  audio: true,
}

const LIMITS = {
  size:     { min: 16,      max: 7680 },
  fps:      { min: 1,       max: 120 },
  video:    { min: 100_000, max: 100_000_000 },
  audio:    { min: 32_000,  max: 512_000 },
  keyframe: { min: 1,       max: 10 },
}

const ENCODERS: readonly EncoderPreference[] = ['auto', 'hardware', 'software']

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * Too small or too large is clamped; not a positive number at all (zero,
 * negative, NaN, a string) is invalid and takes the fallback instead, since
 * there is no sensible reading of "a width of -5".
 */
const clamp = (v: unknown, fallback: number, { min, max }: { min: number; max: number }) =>
  positive(v) ? Math.min(max, Math.max(min, v)) : fallback

/** H.264 needs even dimensions. */
const even = (n: number) => Math.round(n / 2) * 2

export function normalizeParams(raw: unknown, base: SessionParams = DEFAULT_PARAMS): SessionParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  return {
    width: even(clamp(r.width, base.width, LIMITS.size)),
    height: even(clamp(r.height, base.height, LIMITS.size)),
    fps: Math.round(clamp(r.fps, base.fps, LIMITS.fps)),
    videoBitrate: Math.round(clamp(r.videoBitrate, base.videoBitrate, LIMITS.video)),
    audioBitrate: Math.round(clamp(r.audioBitrate, base.audioBitrate, LIMITS.audio)),
    encoder: ENCODERS.includes(r.encoder as EncoderPreference) ? (r.encoder as EncoderPreference) : base.encoder,
    keyframeSeconds: clamp(r.keyframeSeconds, base.keyframeSeconds, LIMITS.keyframe),
    audio: typeof r.audio === 'boolean' ? r.audio : base.audio,
  }
}

/** A sensible bitrate for a resolution and frame rate, when the user has not chosen one. */
export function suggestedVideoBitrate(width: number, height: number, fps: number): number {
  // About 0.1 bits per pixel per frame is a reasonable quality for screen content
  // with a fast encoder; 1080p30 comes to about 6 Mbps.
  const raw = width * height * fps * 0.097
  return Math.round(Math.min(LIMITS.video.max, Math.max(1_000_000, raw)) / 100_000) * 100_000
}
