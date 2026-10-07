/**
 * FFmpeg arguments for outputs fed from the output host.
 *
 * The host composes, mixes and encodes (H.264 and Opus in fragmented MP4) and
 * writes that to FFmpeg's standard input. FFmpeg's job here is only packaging:
 * the picture is copied untouched, and the audio is converted to AAC where the
 * destination needs it. Nothing re-encodes the video, which is why these
 * outputs cost so little CPU.
 *
 * The earlier arguments each had their own `gdigrab` desktop input and their
 * own x264 settings, which is why recording captured the whole screen whatever
 * the scene held.
 */

/** Reads the host's stream from standard input. */
export const PIPE_INPUT = ['-hide_banner', '-loglevel', 'info', '-i', 'pipe:0']

const AAC = (bitrate: number) => ['-c:a', 'aac', '-b:a', `${Math.round(bitrate / 1000)}k`]

export type RecordingFormat = 'mkv' | 'mp4'

/**
 * `trackPipes` are the paths of the extra audio tracks, each a file of sound
 * alone. They become further inputs and further audio streams of the recording.
 */
export function recordingArgs(file: string, format: RecordingFormat, audioBitrate = 160_000, trackPipes: readonly string[] = []): string[] {
  const container =
    format === 'mp4'
      // Fragmented, so a recording that is cut short by a crash or a power loss
      // is still playable up to the last fragment. A plain MP4 keeps its index
      // at the end and is unreadable without it.
      ? ['-movflags', '+frag_keyframe+empty_moov+default_base_moof']
      : []

  if (trackPipes.length === 0) return [...PIPE_INPUT, '-c:v', 'copy', ...AAC(audioBitrate), ...container, '-y', file]

  const names = ['Mix', 'Microphone', 'Everything else']
  return [
    ...PIPE_INPUT,
    ...trackPipes.flatMap((p) => ['-i', p]),
    '-map', '0:v', '-map', '0:a',
    ...trackPipes.map((_, i) => ['-map', `${i + 1}:a`]).flat(),
    '-c:v', 'copy',
    ...AAC(audioBitrate),
    ...names.slice(0, trackPipes.length + 1).flatMap((n, i) => [`-metadata:s:a:${i}`, `title=${n}`]),
    ...container,
    '-y', file,
  ]
}

/** `target` is the server URL joined with the stream key. */
export function streamingArgs(target: string, audioBitrate = 160_000): string[] {
  return [
    ...PIPE_INPUT,
    '-c:v', 'copy',
    ...AAC(audioBitrate),
    '-flvflags', 'no_duration_filesize',
    '-f', 'flv', target,
  ]
}

/**
 * A ring of short segments, so the last N seconds can be saved on request.
 * Segments are cut on keyframes, which the host places every two seconds.
 */
export function replayArgs(segmentDir: string, segmentSeconds: number, maxFiles: number): string[] {
  return [
    ...PIPE_INPUT,
    '-c', 'copy',
    '-f', 'segment',
    '-segment_time', String(segmentSeconds),
    '-segment_wrap', String(maxFiles),
    '-reset_timestamps', '1',
    `${segmentDir.replace(/\\/g, '/')}/seg%05d.mkv`,
  ]
}

/** Video only: consumers of the virtual camera do not take sound from it. */
export function virtualCameraArgs(url: string): string[] {
  return [...PIPE_INPUT, '-c:v', 'copy', '-an', '-f', 'mpegts', url]
}
