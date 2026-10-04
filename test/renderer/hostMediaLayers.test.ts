import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MediaLayers, type MediaVideo, type MediaDeps } from '../../src/host/mediaLayers'
import type { SnapshotSource } from '../../shared/host'

/**
 * Files played for the scene: started when they are wanted, silent in the
 * recorder (their sound is captured instead), let go of when they are not, and
 * able to fail without taking anything else with them.
 */

const T = { x: 0, y: 0, width: 640, height: 360, rotation: 0, scaleX: 1, scaleY: 1 }
const media = (id: string, settings: SnapshotSource['settings'] = { filePath: 'C:/v/a.mp4' }): SnapshotSource => ({
  id, type: 'media_source', order: 0, transform: T, target: null, settings, filters: [],
})

class FakeVideo implements MediaVideo {
  src = ''
  loop = false
  muted = false
  crossOrigin: string | null = null
  readyState = 0
  videoWidth = 0
  videoHeight = 0
  error: { code: number } | null = null
  played = 0
  paused = 0
  loaded = 0
  removed: string[] = []
  listeners: Array<() => void> = []
  tracks = [{ stop: vi.fn() }]
  playResult: () => Promise<void> = async () => {}
  play = vi.fn(async () => { this.played++; await this.playResult() })
  pause() { this.paused++ }
  removeAttribute(name: string) { this.removed.push(name) }
  load() { this.loaded++ }
  captureStream() { return { getTracks: () => this.tracks, getAudioTracks: () => this.tracks } as unknown as MediaStream }
  addEventListener(_type: 'error', listener: () => void) { this.listeners.push(listener) }
  show(w = 1280, h = 720) { this.readyState = 4; this.videoWidth = w; this.videoHeight = h }
  fail(code: number) { this.error = { code }; this.listeners.forEach((l) => l()) }
}

let videos: FakeVideo[]
let resolved: string[]
let changes: number
let resolveUrl: (path: string) => Promise<string>
let layers: MediaLayers

const settle = () => new Promise((r) => setTimeout(r, 0))
const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  videos = []; resolved = []; changes = 0
  resolveUrl = async (p) => `cbmedia://media/${encodeURIComponent(p)}`
  const deps: MediaDeps = {
    resolveUrl: (p) => { resolved.push(p); return resolveUrl(p) },
    createVideo: () => { const v = new FakeVideo(); videos.push(v); return v },
  }
  layers = new MediaLayers(deps, () => { changes++ })
})

describe('starting', () => {
  it('plays the file from the address the main process gives', async () => {
    layers.sync([media('a')])
    await settle()
    expect(resolved).toEqual(['C:/v/a.mp4'])
    expect(videos[0].src).toBe('cbmedia://media/C%3A%2Fv%2Fa.mp4')
    expect(videos[0].played).toBe(1)
  })

  it('keeps the player silent, so nothing comes out of the speakers', async () => {
    layers.sync([media('a')])
    await settle()
    expect(videos[0].muted).toBe(true)
  })

  it('lets the picture be read into the encoder', async () => {
    layers.sync([media('a')])
    await settle()
    expect(videos[0].crossOrigin).toBe('anonymous')
  })

  it('loops by default, and not if asked not to', async () => {
    layers.sync([media('a'), media('b', { filePath: 'x.mp4', loop: false })])
    await settle()
    expect([videos[0].loop, videos[1].loop]).toEqual([true, false])
  })

  it('says when a file is playing', async () => {
    layers.sync([media('a')])
    await settle()
    expect(changes).toBe(1)
  })

  it('plays several at once', async () => {
    layers.sync([media('a'), media('b', { filePath: 'other.mp4' })])
    await settle()
    expect(videos).toHaveLength(2)
  })

  it('leaves out sources that are not media', async () => {
    layers.sync([{ ...media('a'), type: 'display_capture' }, { ...media('b'), type: 'image' }])
    await settle()
    expect(layers.size).toBe(0)
  })

  it('does nothing, without complaint, before a file is chosen', async () => {
    layers.sync([media('a', {})])
    await settle()
    expect(resolved).toEqual([])
    expect(layers.errors()).toEqual({})
    expect(layers.frameFor('a')).toBeNull()
  })
})

describe('keeping up with changes', () => {
  it('does not restart a file that has not changed', async () => {
    layers.sync([media('a')])
    await settle()
    layers.sync([media('a')])
    layers.sync([media('a')])
    await settle()
    expect(videos).toHaveLength(1)
    expect(videos[0].played).toBe(1)
  })

  it('applies a change of loop to what is playing, without restarting it', async () => {
    layers.sync([media('a')])
    await settle()
    layers.sync([media('a', { filePath: 'C:/v/a.mp4', loop: false })])
    expect(videos[0].loop).toBe(false)
    expect(videos).toHaveLength(1)
  })

  it('starts the new file when pointed at another', async () => {
    layers.sync([media('a')])
    await settle()
    layers.sync([media('a', { filePath: 'C:/v/b.mp4' })])
    await settle()
    expect(videos).toHaveLength(2)
    expect(videos[0].paused).toBe(1)
    expect(resolved).toEqual(['C:/v/a.mp4', 'C:/v/b.mp4'])
  })

  it('stops a file whose source was removed, and lets go of it', async () => {
    layers.sync([media('a')])
    await settle()
    layers.sync([])
    expect(videos[0].paused).toBe(1)
    expect(videos[0].removed).toContain('src')
    expect(videos[0].loaded).toBe(1)
    expect(videos[0].tracks[0].stop).toHaveBeenCalled()
    expect(layers.size).toBe(0)
  })

  it('stops everything', async () => {
    layers.sync([media('a'), media('b', { filePath: 'o.mp4' })])
    await settle()
    layers.stopAll()
    expect(layers.size).toBe(0)
    expect(videos.every((v) => v.paused === 1)).toBe(true)
  })
})

describe('a source that goes away while its file is being found', () => {
  it('never starts playing it', async () => {
    const gate = deferred<string>()
    resolveUrl = () => gate.promise
    layers.sync([media('a')])
    layers.sync([])
    gate.resolve('cbmedia://media/late')
    await settle()

    expect(videos[0].played).toBe(0)
    expect(changes).toBe(0)
  })

  it('does not let a stale file replace the new one', async () => {
    const gate = deferred<string>()
    resolveUrl = (p) => (p.endsWith('a.mp4') ? gate.promise : Promise.resolve('cbmedia://media/b'))
    layers.sync([media('a')])
    layers.sync([media('a', { filePath: 'C:/v/b.mp4' })])
    await settle()
    gate.resolve('cbmedia://media/stale')
    await settle()

    expect(videos[0].played).toBe(0)
    expect(videos[1].src).toBe('cbmedia://media/b')
  })
})

describe('the picture', () => {
  it('has none until a frame has been decoded', async () => {
    layers.sync([media('a')])
    await settle()
    expect(layers.frameFor('a')).toBeNull()
  })

  it('offers the player once it has a frame, at the size of the video', async () => {
    layers.sync([media('a')])
    await settle()
    videos[0].show(1920, 1080)
    expect(layers.frameFor('a')).toEqual({ image: videos[0], width: 1920, height: 1080 })
  })

  it('has none for a sound file, which has no picture', async () => {
    layers.sync([media('a', { filePath: 'C:/v/song.mp3' })])
    await settle()
    videos[0].readyState = 4
    expect(layers.frameFor('a')).toBeNull()
    expect(layers.audio()).toHaveLength(1) // but its sound is still there
  })

  it('has none for a source it does not know', () => {
    expect(layers.frameFor('missing')).toBeNull()
  })
})

describe('the sound', () => {
  it('is offered once the file plays, at the level set', async () => {
    layers.sync([media('a', { filePath: 'x.mp4', volume: 0.4 })])
    await settle()
    const [a] = layers.audio()
    expect(a.id).toBe('a')
    expect(a.gain).toBe(0.4)
  })

  it('is silent when muted', async () => {
    layers.sync([media('a', { filePath: 'x.mp4', volume: 0.9, muted: true })])
    await settle()
    expect(layers.audio()[0].gain).toBe(0)
  })

  it('follows a change of volume or mute while playing', async () => {
    layers.sync([media('a', { filePath: 'x.mp4', volume: 1 })])
    await settle()
    layers.sync([media('a', { filePath: 'x.mp4', volume: 0.25 })])
    expect(layers.audio()[0].gain).toBe(0.25)
    layers.sync([media('a', { filePath: 'x.mp4', volume: 0.25, muted: true })])
    expect(layers.audio()[0].gain).toBe(0)
  })

  it('is not offered before the file plays', () => {
    layers.sync([media('a')])
    expect(layers.audio()).toEqual([])
  })

  it('is still offered for the picture if the sound cannot be captured', async () => {
    layers.sync([media('a')])
    const captureStream = FakeVideo.prototype.captureStream
    FakeVideo.prototype.captureStream = () => { throw new Error('no audio') }
    await settle()
    FakeVideo.prototype.captureStream = captureStream

    expect(layers.audio()).toEqual([])
    videos[0].show()
    expect(layers.frameFor('a')).not.toBeNull()
  })
})

describe('failure', () => {
  it('says why when the file cannot be found', async () => {
    resolveUrl = async () => { throw new Error('The file could not be found. It may have been moved or deleted.') }
    layers.sync([media('a')])
    await settle()
    expect(layers.errors()).toEqual({ a: 'The file could not be found. It may have been moved or deleted.' })
    expect(changes).toBe(1)
  })

  it('says what to try when the player cannot handle the file', async () => {
    videos.length = 0
    layers.sync([media('a')])
    await settle()
    videos[0].fail(4)
    expect(layers.errors().a).toMatch(/MP4/)
  })

  it('says what went wrong when playing is refused', async () => {
    layers.sync([media('a')])
    const play = FakeVideo.prototype.play
    void play
    videos[0].playResult = async () => { throw new Error('NotAllowedError') }
    await settle()
    expect(layers.errors().a).toBeDefined()
  })

  it('draws nothing for a file that failed', async () => {
    layers.sync([media('a')])
    await settle()
    videos[0].show()
    videos[0].fail(3)
    expect(layers.frameFor('a')).toBeNull()
    expect(layers.audio()).toEqual([])
  })

  it('does not try again by itself', async () => {
    resolveUrl = async () => { throw new Error('nope') }
    layers.sync([media('a')])
    await settle()
    layers.sync([media('a')])
    await settle()
    expect(resolved).toHaveLength(1)
  })

  it('does not disturb a file that is playing when another fails', async () => {
    resolveUrl = async (p) => { if (p === 'bad.mp4') throw new Error('nope'); return 'cbmedia://media/ok' }
    layers.sync([media('good', { filePath: 'good.mp4' }), media('bad', { filePath: 'bad.mp4' })])
    await settle()
    videos[0].show()
    expect(layers.frameFor('good')).not.toBeNull()
    expect(layers.errors()).toEqual({ bad: 'nope' })
  })

  it('uses a plain message when the failure has none', async () => {
    resolveUrl = async () => { throw new Error('') }
    layers.sync([media('a')])
    await settle()
    expect(layers.errors().a).toBe('The file could not be played.')
  })
})
