/**
 * The size, frame rate and bitrate each output is made at.
 *
 * By default every output follows the Video tab. A recording and a stream can
 * each be given their own: a 1080p60 file for editing while streaming 720p30
 * that a home upload can carry. The scene is composed once per output at that
 * output's size, so a smaller stream costs less, not more.
 */

export interface OutputQuality {
  /** Picture height; the width follows the Video tab's shape. 0 is the Video tab's size. */
  height: number
  /** 0 is the Video tab's frame rate. */
  fps: number
  /** kbit/s. 0 picks one to suit the size and frame rate; -1 uses the recording's. */
  videoBitrateKbps: number
}

export const SAME_AS_VIDEO: OutputQuality = { height: 0, fps: 0, videoBitrateKbps: -1 }

export const QUALITY_HEIGHTS = [2160, 1440, 1080, 900, 720, 480, 360] as const
export const QUALITY_FPS = [24, 25, 30, 48, 50, 60] as const

/** Reads a stored choice, keeping what is usable and the default for anything else. */
export function parseQuality(raw: unknown): OutputQuality {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const int = (v: unknown, ok: (n: number) => boolean, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && ok(v) ? v : fallback
  return {
    height: int(r.height, (n) => n === 0 || (n >= 144 && n <= 4320), 0),
    fps: int(r.fps, (n) => n === 0 || (n >= 1 && n <= 120), 0),
    videoBitrateKbps: int(r.videoBitrateKbps, (n) => n >= -1 && n <= 100_000, -1),
  }
}

/**
 * The output size for a chosen height, keeping the shape of the Video tab's
 * output (16:9 stays 16:9). Both sides even, which H.264 needs. A height of 0,
 * or the Video tab's own height, gives the Video tab's size unchanged.
 */
export function sizeFor(height: number, base: { width: number; height: number }): { width: number; height: number } {
  if (!height || height === base.height || base.height <= 0) return { width: base.width, height: base.height }
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return { width: even((base.width * height) / base.height), height: even(height) }
}

/** How a choice reads in the settings, for the summary line. */
export function describeQuality(q: OutputQuality, base: { width: number; height: number }, baseFps: number): string {
  const size = sizeFor(q.height, base)
  return `${size.width}x${size.height} at ${q.fps || baseFps} fps`
}
