import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CapturePool, type PoolVideo } from '../../src/host/capturePool'
import type { CaptureTarget } from '../../src/lib/capture/target'
import type { SnapshotSource } from '../../shared/host'

/**
 * The output host keeps its own captures open. The scene state arrives on every
 * change, including every pixel of a drag, so the pool must not restart what has
 * not changed, and must cope with a source going away while it is still opening.
 */

const SCREEN: CaptureTarget = { kind: 'screen', id: 'screen:0:0', name: 'Entire screen' }
const WINDOW: CaptureTarget = { kind: 'window', id: 'window:5:0', name: 'Notepad' }

const source = (id: string, target: CaptureTarget | null, type = 'display_capture'): SnapshotSource => ({
  id, type, order: 0, target,
  transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0, scaleX: 1, scaleY: 1 },
})

function fakeStream() {
  let onEnded: (() => void) | undefined
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn((event: string, cb: () => void) => { if (event === 'ended') onEnded = cb }),
  }
  return {
    track,
    stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
    end: () => onEnded?.(),
  }
}

class FakeVideo implements PoolVideo {
  srcObject: MediaStream | null = null
  muted = false
  readyState = 0
  videoWidth = 0
  videoHeight = 0
  play = vi.fn(async () => {})
  showFrame(w = 1920, h = 1080) { this.readyState = 4; this.videoWidth = w; this.videoHeight = h }
}

/** Resolves later, so tests can interleave things with an open in progress. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

let videos: FakeVideo[]
let opens: CaptureTarget[]
let changes: number
let pool: CapturePool
let nextStream: () => Promise<MediaStream>

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  videos = []
  opens = []
  changes = 0
  nextStream = async () => fakeStream().stream
  pool = new CapturePool(
    {
      open: async (target) => { opens.push(target); return nextStream() },
      createVideo: () => { const v = new FakeVideo(); videos.push(v); return v },
    },
    () => { changes++ },
  )
})

describe('starting captures', () => {
  it('opens the target of a capture source', async () => {
    pool.sync([source('a', SCREEN)])
    await settle()

    expect(opens).toEqual([SCREEN])
  })

  it('plays the stream muted, in a video it owns', async () => {
    pool.sync([source('a', SCREEN)])
    await settle()

    expect(videos[0].srcObject).not.toBeNull()
    expect(videos[0].muted).toBe(true)
    expect(videos[0].play).toHaveBeenCalled()
  })

  it('tells the host when a capture goes live', async () => {
    pool.sync([source('a', SCREEN)])
    await settle()
    expect(changes).toBe(1)
  })

  it('opens several at once', async () => {
    pool.sync([source('a', SCREEN), source('b', WINDOW, 'window_capture')])
    await settle()
    expect(opens).toHaveLength(2)
  })

  it('leaves out sources that do not capture, or have no target', async () => {
    pool.sync([source('img', SCREEN, 'image'), source('blank', null), source('text', null, 'text_gdi_plus')])
    await settle()

    expect(opens).toEqual([])
    expect(pool.size).toBe(0)
  })
})

describe('keeping up with changes', () => {
  // The scene state arrives for every pixel of a drag.
  it('does not restart a capture that has not changed', async () => {
    pool.sync([source('a', SCREEN)])
    await settle()
    pool.sync([source('a', SCREEN)])
    pool.sync([source('a', SCREEN)])
    await settle()

    expect(opens).toHaveLength(1)
  })

  it('does not restart one whose position changed', async () => {
    pool.sync([source('a', SCREEN)])
    await settle()
    pool.sync([{ ...source('a', SCREEN), transform: { ...source('a', SCREEN).transform, x: 400 } }])
    await settle()

    expect(opens).toHaveLength(1)
  })

  it('stops a capture whose source was removed', async () => {
    const s = fakeStream()
    nextStream = async () => s.stream
    pool.sync([source('a', SCREEN)])
    await settle()

    pool.sync([])

    expect(s.track.stop).toHaveBeenCalled()
    expect(videos[0].srcObject).toBeNull()
    expect(pool.size).toBe(0)
  })

  it('reopens a capture that now points somewhere else, releasing the old one', async () => {
    const first = fakeStream()
    nextStream = async () => first.stream
    pool.sync([source('a', SCREEN)])
    await settle()

    nextStream = async () => fakeStream().stream
    pool.sync([source('a', WINDOW, 'window_capture')])
    await settle()

    expect(first.track.stop).toHaveBeenCalled()
    expect(opens).toEqual([SCREEN, WINDOW])
  })

  it('stops everything', async () => {
    const s = fakeStream()
    nextStream = async () => s.stream
    pool.sync([source('a', SCREEN), source('b', WINDOW)])
    await settle()

    pool.stopAll()

    expect(pool.size).toBe(0)
    expect(s.track.stop).toHaveBeenCalled()
  })
})

describe('a source that goes away while its capture is opening', () => {
  it('stops the stream the moment it arrives rather than leaking it', async () => {
    const gate = deferred<MediaStream>()
    nextStream = () => gate.promise
    pool.sync([source('a', SCREEN)])
    await settle()

    pool.sync([]) // removed while still opening
    const late = fakeStream()
    gate.resolve(late.stream)
    await settle()

    expect(late.track.stop).toHaveBeenCalled()
    expect(pool.frameFor('a')).toBeNull()
  })

  it('does not show a stale capture after the source was retargeted', async () => {
    const gate = deferred<MediaStream>()
    nextStream = () => gate.promise
    pool.sync([source('a', SCREEN)])
    await settle()

    nextStream = async () => fakeStream().stream
    pool.sync([source('a', WINDOW, 'window_capture')])
    const stale = fakeStream()
    gate.resolve(stale.stream)
    await settle()

    expect(stale.track.stop).toHaveBeenCalled()
  })
})

describe('what can be drawn', () => {
  it('has nothing until the video has a frame', async () => {
    pool.sync([source('a', SCREEN)])
    await settle()

    expect(pool.frameFor('a')).toBeNull()
  })

  it('offers the video once it has decoded a frame', async () => {
    pool.sync([source('a', SCREEN)])
    await settle()
    videos[0].showFrame(1280, 720)

    expect(pool.frameFor('a')).toEqual({ image: videos[0], width: 1280, height: 720 })
  })

  it('has nothing for a video that reports no size', async () => {
    pool.sync([source('a', SCREEN)])
    await settle()
    videos[0].readyState = 4

    expect(pool.frameFor('a')).toBeNull()
  })

  it('has nothing for a source it does not know', () => {
    expect(pool.frameFor('missing')).toBeNull()
  })
})

describe('failures', () => {
  it('records why a capture failed', async () => {
    nextStream = async () => { throw new Error('"Notepad" is not open.') }
    pool.sync([source('a', WINDOW, 'window_capture')])
    await settle()

    expect(pool.errors()).toEqual({ a: '"Notepad" is not open.' })
    expect(changes).toBe(1)
  })

  it('draws nothing for a failed capture', async () => {
    nextStream = async () => { throw new Error('nope') }
    pool.sync([source('a', SCREEN)])
    await settle()
    videos[0].showFrame()

    expect(pool.frameFor('a')).toBeNull()
  })

  it('uses a plain message when the failure has none', async () => {
    nextStream = async () => { throw new Error('') }
    pool.sync([source('a', SCREEN)])
    await settle()
    expect(pool.errors().a).toBe('Capture failed.')
  })

  it('notices when the captured window closes', async () => {
    const s = fakeStream()
    nextStream = async () => s.stream
    pool.sync([source('a', SCREEN)])
    await settle()
    videos[0].showFrame()
    expect(pool.frameFor('a')).not.toBeNull()

    s.end()

    expect(pool.errors().a).toBe('The source was closed.')
    expect(pool.frameFor('a')).toBeNull()
  })

  it('does not retry on its own', async () => {
    nextStream = async () => { throw new Error('nope') }
    pool.sync([source('a', SCREEN)])
    await settle()
    pool.sync([source('a', SCREEN)])
    await settle()

    expect(opens).toHaveLength(1)
  })

  it('retries the ones that failed when asked', async () => {
    nextStream = async () => { throw new Error('"Notepad" is not open.') }
    pool.sync([source('a', WINDOW, 'window_capture')])
    await settle()

    nextStream = async () => fakeStream().stream // the window is open now
    pool.retryFailed()
    await settle()

    expect(opens).toHaveLength(2)
    expect(pool.errors()).toEqual({})
  })

  it('leaves working captures alone when retrying', async () => {
    pool.sync([source('ok', SCREEN)])
    await settle()

    pool.retryFailed()
    await settle()

    expect(opens).toHaveLength(1)
  })

  it('a capture that keeps working is not disturbed by another failing', async () => {
    let call = 0
    nextStream = async () => {
      call++
      if (call === 2) throw new Error('second failed')
      return fakeStream().stream
    }
    pool.sync([source('a', SCREEN), source('b', WINDOW, 'window_capture')])
    await settle()
    videos[0].showFrame()

    expect(pool.frameFor('a')).not.toBeNull()
    expect(pool.errors()).toEqual({ b: 'second failed' })
  })
})
