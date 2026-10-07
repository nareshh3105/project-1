import { describe, it, expect } from 'vitest'
import {
  PIPE_INPUT, recordingArgs, streamingArgs, replayArgs, virtualCameraArgs,
} from '../../electron/main/output/pipeArgs'
import { normalizeParams, suggestedVideoBitrate, DEFAULT_PARAMS } from '../../electron/main/output/params'

/**
 * Outputs fed from the host copy the picture and only package it. These pin the
 * arguments that make that true, because a stray re-encode or a desktop input
 * would quietly bring back the old behaviour of recording the whole screen.
 */

const has = (args: string[], ...seq: string[]) =>
  args.some((_, i) => seq.every((s, j) => args[i + j] === s))

describe('every host-fed output', () => {
  const all = {
    recording: recordingArgs('C:/v/out.mkv', 'mkv'),
    streaming: streamingArgs('rtmp://live.example/app/key'),
    replay: replayArgs('C:/tmp/replay', 5, 9),
    virtualCamera: virtualCameraArgs('udp://127.0.0.1:1234'),
  }

  it.each(Object.entries(all))('%s reads the host\'s stream from stdin', (_name, args) => {
    expect(has(args, '-i', 'pipe:0')).toBe(true)
    expect(args.slice(0, PIPE_INPUT.length)).toEqual(PIPE_INPUT)
  })

  // The old arguments captured the desktop directly, which is why a scene had no
  // effect on the output.
  it.each(Object.entries(all))('%s never captures the desktop itself', (_name, args) => {
    expect(args).not.toContain('gdigrab')
    expect(args).not.toContain('desktop')
    expect(args).not.toContain('dshow')
  })

  it.each(Object.entries(all))('%s does not re-encode the picture', (_name, args) => {
    expect(args).not.toContain('libx264')
    expect(has(args, '-c:v', 'copy') || has(args, '-c', 'copy')).toBe(true)
  })
})

describe('recording', () => {
  it('writes to the file it was given', () => {
    expect(recordingArgs('C:/v/out.mkv', 'mkv').at(-1)).toBe('C:/v/out.mkv')
  })

  it('overwrites rather than prompting, since the path is already unique', () => {
    expect(recordingArgs('C:/v/out.mkv', 'mkv')).toContain('-y')
  })

  it('converts the audio to AAC at the requested rate', () => {
    expect(has(recordingArgs('a.mkv', 'mkv', 192_000), '-c:a', 'aac', '-b:a', '192k')).toBe(true)
  })

  it('makes an MP4 survive being cut short', () => {
    const mp4 = recordingArgs('a.mp4', 'mp4')
    expect(has(mp4, '-movflags', '+frag_keyframe+empty_moov+default_base_moof')).toBe(true)
  })

  it('does not add MP4 options to a Matroska file', () => {
    expect(recordingArgs('a.mkv', 'mkv')).not.toContain('-movflags')
  })
})

describe('streaming', () => {
  it('sends FLV, which is what RTMP requires', () => {
    expect(has(streamingArgs('rtmp://x/y'), '-f', 'flv', 'rtmp://x/y')).toBe(true)
  })

  it('targets the URL it was given, last', () => {
    expect(streamingArgs('rtmp://live.example/app/key').at(-1)).toBe('rtmp://live.example/app/key')
  })

  it('carries AAC, which FLV streaming services expect', () => {
    expect(has(streamingArgs('rtmp://x/y'), '-c:a', 'aac')).toBe(true)
  })
})

describe('replay buffer', () => {
  it('cuts the stream into a ring of segments', () => {
    const args = replayArgs('C:/tmp/replay', 5, 9)
    expect(has(args, '-f', 'segment')).toBe(true)
    expect(has(args, '-segment_time', '5')).toBe(true)
    expect(has(args, '-segment_wrap', '9')).toBe(true)
  })

  it('numbers segments in the directory it was given', () => {
    expect(replayArgs('C:/tmp/replay', 5, 9).at(-1)).toBe('C:/tmp/replay/seg%05d.mkv')
  })

  it('uses forward slashes, which FFmpeg accepts on Windows', () => {
    expect(replayArgs('C:\\tmp\\replay', 5, 9).at(-1)).toBe('C:/tmp/replay/seg%05d.mkv')
  })

  it('keeps the audio with the picture', () => {
    expect(has(replayArgs('d', 5, 9), '-c', 'copy')).toBe(true)
    expect(replayArgs('d', 5, 9)).not.toContain('-an')
  })
})

describe('virtual camera', () => {
  it('publishes MPEG-TS to the URL', () => {
    const args = virtualCameraArgs('udp://127.0.0.1:1234')
    expect(has(args, '-f', 'mpegts', 'udp://127.0.0.1:1234')).toBe(true)
  })

  it('carries no audio', () => {
    expect(virtualCameraArgs('udp://x')).toContain('-an')
  })
})

describe('normalizeParams', () => {
  it('fills in everything that is missing', () => {
    expect(normalizeParams(undefined)).toEqual(DEFAULT_PARAMS)
    expect(normalizeParams({})).toEqual(DEFAULT_PARAMS)
    expect(normalizeParams('nonsense')).toEqual(DEFAULT_PARAMS)
  })

  it('keeps valid values', () => {
    const given = { width: 1280, height: 720, fps: 60, videoBitrate: 9_000_000, audioBitrate: 128_000, encoder: 'software', keyframeSeconds: 2, audio: false, tracks: 3 }
    expect(normalizeParams(given)).toEqual(given)
  })

  it.each([NaN, Infinity, -5, 'wide', null, undefined, {}])('replaces a width of %s', (bad) => {
    expect(normalizeParams({ width: bad }).width).toBe(DEFAULT_PARAMS.width)
  })

  it('rounds dimensions to even numbers, which H.264 requires', () => {
    expect(normalizeParams({ width: 1281, height: 721 })).toMatchObject({ width: 1282, height: 722 })
  })

  it('clamps absurd sizes instead of passing them to an encoder', () => {
    expect(normalizeParams({ width: 1, height: 1 })).toMatchObject({ width: 16, height: 16 })
    expect(normalizeParams({ width: 1e9, height: 1e9 })).toMatchObject({ width: 7680, height: 7680 })
  })

  it('clamps the frame rate to something an encoder can do', () => {
    expect(normalizeParams({ fps: 0.4 }).fps).toBe(1)
    expect(normalizeParams({ fps: 10_000 }).fps).toBe(120)
  })

  // Zero is not "a very small rate", it is no rate at all.
  it('treats a frame rate of zero as missing', () => {
    expect(normalizeParams({ fps: 0 }).fps).toBe(DEFAULT_PARAMS.fps)
  })

  it('clamps bitrates', () => {
    expect(normalizeParams({ videoBitrate: 1 }).videoBitrate).toBe(100_000)
    expect(normalizeParams({ videoBitrate: 1e12 }).videoBitrate).toBe(100_000_000)
    expect(normalizeParams({ audioBitrate: 1 }).audioBitrate).toBe(32_000)
  })

  it('accepts only a known encoder preference', () => {
    expect(normalizeParams({ encoder: 'hardware' }).encoder).toBe('hardware')
    expect(normalizeParams({ encoder: 'quantum' }).encoder).toBe('auto')
  })

  it('keeps audio on unless told otherwise', () => {
    expect(normalizeParams({}).audio).toBe(true)
    expect(normalizeParams({ audio: false }).audio).toBe(false)
    expect(normalizeParams({ audio: 'no' }).audio).toBe(true)
  })

  it('takes its fallbacks from the base it is given', () => {
    const base = { ...DEFAULT_PARAMS, fps: 60 }
    expect(normalizeParams({}, base).fps).toBe(60)
  })
})

describe('suggestedVideoBitrate', () => {
  it('suggests about 6 Mbps for 1080p30', () => {
    expect(suggestedVideoBitrate(1920, 1080, 30)).toBe(6_000_000)
  })

  it('suggests more for 60 fps', () => {
    expect(suggestedVideoBitrate(1920, 1080, 60)).toBeGreaterThan(suggestedVideoBitrate(1920, 1080, 30))
  })

  it('suggests less for a smaller picture', () => {
    expect(suggestedVideoBitrate(1280, 720, 30)).toBeLessThan(suggestedVideoBitrate(1920, 1080, 30))
  })

  it('never suggests less than 1 Mbps', () => {
    expect(suggestedVideoBitrate(160, 90, 5)).toBe(1_000_000)
  })
})

describe('tracks', () => {
  it('is one unless asked', () => {
    expect(normalizeParams({}).tracks).toBe(1)
  })

  it.each([[2, 2], [3, 3], [1, 1], [9, 3], [2.4, 2], [0, 1], [-1, 1], [NaN, 1], ['2', 1], [null, 1]])('reads %s as %s', (given, expected) => {
    expect(normalizeParams({ tracks: given }).tracks).toBe(expected)
  })
})

describe('recording with extra tracks', () => {
  const pipes = ['\\.\pipe\a', '\\.\pipe\b']
  const inputs = (args: string[]) => args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []))

  it('is unchanged without them', () => {
    expect(recordingArgs('a.mkv', 'mkv', 160_000, [])).toEqual(recordingArgs('a.mkv', 'mkv', 160_000))
    expect(recordingArgs('a.mkv', 'mkv')).not.toContain('-map')
  })

  it('reads each pipe as a further input after the standard input', () => {
    expect(inputs(recordingArgs('a.mkv', 'mkv', 160_000, pipes))).toEqual(['pipe:0', ...pipes])
  })

  it('puts the picture and every audio stream in the file', () => {
    const args = recordingArgs('a.mkv', 'mkv', 160_000, pipes)
    const maps = args.flatMap((a, i) => (a === '-map' ? [args[i + 1]] : []))
    expect(maps).toEqual(['0:v', '0:a', '1:a', '2:a'])
  })

  it('names the tracks', () => {
    const args = recordingArgs('a.mkv', 'mkv', 160_000, pipes)
    expect(has(args, '-metadata:s:a:0', 'title=Mix')).toBe(true)
    expect(has(args, '-metadata:s:a:1', 'title=Microphone')).toBe(true)
    expect(has(args, '-metadata:s:a:2', 'title=Everything else')).toBe(true)
  })

  it('copies the picture and converts every sound track', () => {
    const args = recordingArgs('a.mp4', 'mp4', 192_000, pipes)
    expect(has(args, '-c:v', 'copy')).toBe(true)
    expect(has(args, '-c:a', 'aac', '-b:a', '192k')).toBe(true)
    expect(args).toContain('+frag_keyframe+empty_moov+default_base_moof')
    expect(args.at(-1)).toBe('a.mp4')
  })
})
