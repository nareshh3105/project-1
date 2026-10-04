import { describe, it, expect } from 'vitest'
import { parseMedia, mediaGain, fileNameOf, playbackProblem, isMediaType, DEFAULT_MEDIA } from '../../src/lib/sources/media'

describe('media settings', () => {
  it('start from sensible defaults', () => {
    expect(parseMedia(undefined)).toEqual(DEFAULT_MEDIA)
    expect(parseMedia({})).toEqual({ filePath: '', loop: true, volume: 1, muted: false })
  })

  it('keep valid choices', () => {
    expect(parseMedia({ filePath: String.raw`C:\v\a.mp4`, loop: false, volume: 0.4, muted: true }))
      .toEqual({ filePath: String.raw`C:\v\a.mp4`, loop: false, volume: 0.4, muted: true })
  })

  it('loop unless switched off', () => {
    expect(parseMedia({ loop: 'no' }).loop).toBe(true)
    expect(parseMedia({ loop: false }).loop).toBe(false)
  })

  it.each([[-3, 0], [9, 1], [NaN, 1], [Infinity, 1], ['loud', 1], [null, 1]])('reads a volume of %s as %s', (given, expected) => {
    expect(parseMedia({ volume: given }).volume).toBe(expected)
  })

  it('treats anything but true as not muted', () => {
    expect(parseMedia({ muted: 'yes' }).muted).toBe(false)
  })

  it('ignores a path that is not text, and cuts an absurd one', () => {
    expect(parseMedia({ filePath: 5 }).filePath).toBe('')
    expect(parseMedia({ filePath: 'x'.repeat(5000) }).filePath).toHaveLength(1024)
  })
})

describe('mediaGain', () => {
  it('is the volume', () => expect(mediaGain(parseMedia({ volume: 0.3 }))).toBe(0.3))
  it('is silence when muted, whatever the volume', () => expect(mediaGain(parseMedia({ volume: 1, muted: true }))).toBe(0))
})

describe('fileNameOf', () => {
  it.each([[String.raw`C:\videos\clip.mp4`, 'clip.mp4'], ['/home/me/clip.mp4', 'clip.mp4'], ['clip.mp4', 'clip.mp4'], ['', '']])('%s is %s', (p, name) => {
    expect(fileNameOf(p)).toBe(name)
  })
})

describe('playbackProblem', () => {
  it.each([[2, /could not be read/], [3, /damaged/], [4, /cannot be played/], [1, /could not be played/], [undefined, /could not be played/]])(
    'explains error %s', (code, pattern) => expect(playbackProblem(code)).toMatch(pattern))
  it('suggests formats that work for the ones that do not', () => {
    expect(playbackProblem(4)).toMatch(/MP4/)
  })
})

describe('isMediaType', () => {
  it('is only the media source', () => {
    expect(isMediaType('media_source')).toBe(true)
    expect(isMediaType('image')).toBe(false)
  })
})
