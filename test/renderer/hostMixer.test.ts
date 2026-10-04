import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Mixer, type MixerDeps } from '../../src/host/mixer'
import type { SnapshotChannel } from '../../shared/host'

/**
 * What the user hears in the mixer must be what is recorded: faders and mutes
 * apply to the output, inputs the interface has connected are opened, and ones
 * it has released are let go, including when that happens mid-open.
 */

const ch = (id: string, over: Partial<SnapshotChannel> = {}): SnapshotChannel => ({
  id, volume: 1, muted: false, noiseSuppression: false, connected: true, deviceId: '', ...over,
})

function fakeStream() {
  let onEnded: (() => void) | undefined
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn((e: string, cb: () => void) => { if (e === 'ended') onEnded = cb }),
  }
  return {
    track,
    stream: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream,
    end: () => onEnded?.(),
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))
const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

let opened: string[]
let devicesAsked: string[]
let gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>
let sources: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>
let streams: Record<string, ReturnType<typeof fakeStream>>
let openInput: (id: string) => Promise<MediaStream>
let changes: number
let mixer: Mixer
const DEST = { dest: true }

beforeEach(() => {
  opened = []; devicesAsked = []; gains = []; sources = []; streams = {}; changes = 0
  openInput = async (id) => { const s = fakeStream(); streams[id] = s; return s.stream }
  const deps: MixerDeps = {
    openInput: (id, deviceId) => { opened.push(id); devicesAsked.push(deviceId); return openInput(id) },
    createGain: () => { const g = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }; gains.push(g); return g },
    createSource: () => { const s = { connect: vi.fn(), disconnect: vi.fn() }; sources.push(s); return s },
  }
  mixer = new Mixer(deps, DEST, () => { changes++ })
})

describe('opening inputs', () => {
  it('opens a channel the interface has connected', async () => {
    mixer.apply([ch('mic')])
    await settle()

    expect(opened).toEqual(['mic'])
    expect(mixer.openChannels).toEqual(['mic'])
  })

  it('leaves alone channels that are not connected', async () => {
    mixer.apply([ch('mic', { connected: false })])
    await settle()
    expect(opened).toEqual([])
  })

  it('leaves alone channels that have no input to open', async () => {
    mixer.apply([ch('music'), ch('browser')])
    await settle()
    expect(opened).toEqual([])
  })

  it('wires input through its own gain into the mix', async () => {
    mixer.apply([ch('mic')])
    await settle()

    expect(sources[0].connect).toHaveBeenCalledWith(gains[0])
    expect(gains[0].connect).toHaveBeenCalledWith(DEST)
  })

  it('opens each channel once, however many snapshots arrive', async () => {
    mixer.apply([ch('mic')])
    mixer.apply([ch('mic')])
    await settle()
    mixer.apply([ch('mic')])
    await settle()

    expect(opened).toEqual(['mic'])
  })

  it('tells the host when an input comes up', async () => {
    mixer.apply([ch('mic')])
    await settle()
    expect(changes).toBe(1)
  })
})

describe('levels', () => {
  it('applies the fader', async () => {
    mixer.apply([ch('mic', { volume: 0.4 })])
    await settle()
    expect(gains[0].gain.value).toBe(0.4)
  })

  it('silences a muted channel without closing it', async () => {
    mixer.apply([ch('mic', { volume: 0.8, muted: true })])
    await settle()

    expect(gains[0].gain.value).toBe(0)
    expect(mixer.openChannels).toEqual(['mic'])
  })

  it('follows fader moves and mute toggles', async () => {
    mixer.apply([ch('mic', { volume: 1 })])
    await settle()

    mixer.apply([ch('mic', { volume: 0.25 })])
    expect(gains[0].gain.value).toBe(0.25)

    mixer.apply([ch('mic', { volume: 0.25, muted: true })])
    expect(gains[0].gain.value).toBe(0)

    mixer.apply([ch('mic', { volume: 0.25, muted: false })])
    expect(gains[0].gain.value).toBe(0.25)
  })

  it('applies a fader move made while the input was still opening', async () => {
    const gate = deferred<MediaStream>()
    openInput = () => gate.promise
    mixer.apply([ch('mic', { volume: 1 })])
    mixer.apply([ch('mic', { volume: 0.3 })])

    gate.resolve(fakeStream().stream)
    await settle()

    expect(gains[0].gain.value).toBe(0.3)
  })

  it.each([[2, 1], [-1, 0], [NaN, 0], [Infinity, 0]])('clamps a volume of %s to %s', async (given, expected) => {
    mixer.apply([ch('mic', { volume: given })])
    await settle()
    expect(gains[0].gain.value).toBe(expected)
  })

  it('mixes channels independently', async () => {
    mixer.apply([ch('mic', { volume: 0.5 }), ch('desktop', { volume: 0.9, muted: true })])
    await settle()

    const byOrder = opened.map((id, i) => [id, gains[i].gain.value])
    expect(Object.fromEntries(byOrder)).toEqual({ mic: 0.5, desktop: 0 })
  })
})

describe('letting go', () => {
  it('releases a channel the interface disconnected', async () => {
    mixer.apply([ch('mic')])
    await settle()

    mixer.apply([ch('mic', { connected: false })])

    expect(streams.mic.track.stop).toHaveBeenCalled()
    expect(sources[0].disconnect).toHaveBeenCalled()
    expect(gains[0].disconnect).toHaveBeenCalled()
    expect(mixer.openChannels).toEqual([])
  })

  it('releases a channel that disappeared from the snapshot', async () => {
    mixer.apply([ch('mic')])
    await settle()
    mixer.apply([])
    expect(mixer.openChannels).toEqual([])
  })

  it('reopens a channel that is connected again', async () => {
    mixer.apply([ch('mic')])
    await settle()
    mixer.apply([ch('mic', { connected: false })])
    mixer.apply([ch('mic')])
    await settle()

    expect(opened).toEqual(['mic', 'mic'])
    expect(mixer.openChannels).toEqual(['mic'])
  })

  it('stops an input that arrives after its channel was disconnected', async () => {
    const gate = deferred<MediaStream>()
    openInput = () => gate.promise
    mixer.apply([ch('mic')])
    mixer.apply([ch('mic', { connected: false })])

    const late = fakeStream()
    gate.resolve(late.stream)
    await settle()

    expect(late.track.stop).toHaveBeenCalled()
    expect(mixer.openChannels).toEqual([])
  })

  it('stops an input that arrives after the mixer was disposed', async () => {
    const gate = deferred<MediaStream>()
    openInput = () => gate.promise
    mixer.apply([ch('mic')])
    mixer.dispose()

    const late = fakeStream()
    gate.resolve(late.stream)
    await settle()

    expect(late.track.stop).toHaveBeenCalled()
    expect(sources).toHaveLength(0)
  })

  it('disposes everything', async () => {
    mixer.apply([ch('mic'), ch('desktop')])
    await settle()
    mixer.dispose()

    expect(mixer.openChannels).toEqual([])
    expect(streams.mic.track.stop).toHaveBeenCalled()
    expect(streams.desktop.track.stop).toHaveBeenCalled()
  })

  it('survives nodes that are already disconnected', async () => {
    mixer.apply([ch('mic')])
    await settle()
    sources[0].disconnect.mockImplementation(() => { throw new Error('gone') })
    expect(() => mixer.dispose()).not.toThrow()
  })
})

describe('failures', () => {
  it('records why an input could not be opened', async () => {
    openInput = async () => { throw new Error('No microphone device was found.') }
    mixer.apply([ch('mic')])
    await settle()

    expect(mixer.errors()).toEqual({ mic: 'No microphone device was found.' })
    expect(changes).toBe(1)
  })

  it('uses a plain message when the failure has none', async () => {
    openInput = async () => { throw new Error('') }
    mixer.apply([ch('mic')])
    await settle()
    expect(mixer.errors().mic).toBe('Could not open the input.')
  })

  it('does not retry on its own, but tries again when reconnected', async () => {
    openInput = async () => { throw new Error('busy') }
    mixer.apply([ch('mic')])
    await settle()
    mixer.apply([ch('mic')])
    await settle()
    expect(opened).toHaveLength(1)

    openInput = async () => fakeStream().stream
    mixer.apply([ch('mic', { connected: false })])
    mixer.apply([ch('mic')])
    await settle()

    expect(opened).toHaveLength(2)
    expect(mixer.errors()).toEqual({})
  })

  it('a failing channel does not disturb a working one', async () => {
    openInput = async (id) => {
      if (id === 'desktop') throw new Error('no loopback')
      return fakeStream().stream
    }
    mixer.apply([ch('mic'), ch('desktop')])
    await settle()

    expect(mixer.openChannels).toEqual(['mic'])
    expect(mixer.errors()).toEqual({ desktop: 'no loopback' })
  })

  it('notices a device being unplugged', async () => {
    mixer.apply([ch('mic')])
    await settle()
    changes = 0

    streams.mic.end()

    expect(mixer.openChannels).toEqual([])
    expect(mixer.errors().mic).toBe('The input was disconnected.')
    expect(changes).toBe(1)
  })

  it('ignores the ending of an input it already replaced', async () => {
    mixer.apply([ch('mic')])
    await settle()
    const first = streams.mic
    mixer.apply([ch('mic', { connected: false })])
    mixer.apply([ch('mic')])
    await settle()

    first.end()

    expect(mixer.openChannels).toEqual(['mic'])
    expect(mixer.errors()).toEqual({})
  })
})

describe('choosing a device', () => {
  it('opens the device that was chosen', async () => {
    mixer.apply([ch('mic', { deviceId: 'usb-mic' })])
    await settle()
    expect(devicesAsked).toEqual(['usb-mic'])
  })

  it('opens the system default when none is chosen', async () => {
    mixer.apply([ch('mic')])
    await settle()
    expect(devicesAsked).toEqual([''])
  })

  it('treats a missing device as the default rather than as a change', async () => {
    mixer.apply([ch('mic', { deviceId: undefined as never })])
    await settle()
    mixer.apply([ch('mic', { deviceId: undefined as never })])
    await settle()
    expect(opened).toEqual(['mic'])
  })

  it('switches to another device, letting go of the first', async () => {
    mixer.apply([ch('mic', { deviceId: 'a' })])
    await settle()
    const first = streams.mic

    mixer.apply([ch('mic', { deviceId: 'b' })])
    await settle()

    expect(first.track.stop).toHaveBeenCalled()
    expect(devicesAsked).toEqual(['a', 'b'])
    expect(mixer.openChannels).toEqual(['mic'])
  })

  it('does not reopen for a fader move on the same device', async () => {
    mixer.apply([ch('mic', { deviceId: 'a' })])
    await settle()
    mixer.apply([ch('mic', { deviceId: 'a', volume: 0.3 })])
    await settle()
    expect(opened).toEqual(['mic'])
  })

  it('stops a device that arrives after another was chosen', async () => {
    const gate = deferred<MediaStream>()
    openInput = () => gate.promise
    mixer.apply([ch('mic', { deviceId: 'a' })])

    openInput = async () => fakeStream().stream
    mixer.apply([ch('mic', { deviceId: 'b' })])

    const late = fakeStream()
    gate.resolve(late.stream)
    await settle()

    expect(late.track.stop).toHaveBeenCalled()
    expect(devicesAsked).toEqual(['a', 'b'])
    expect(mixer.openChannels).toEqual(['mic'])
  })

  it('tries again with a new device after the old one failed', async () => {
    openInput = async () => { throw new Error('gone') }
    mixer.apply([ch('mic', { deviceId: 'a' })])
    await settle()
    expect(mixer.errors().mic).toBe('gone')

    openInput = async () => fakeStream().stream
    mixer.apply([ch('mic', { deviceId: 'b' })])
    await settle()

    expect(mixer.errors()).toEqual({})
    expect(mixer.openChannels).toEqual(['mic'])
  })

  it('does not hammer a failing device on every update', async () => {
    openInput = async () => { throw new Error('gone') }
    mixer.apply([ch('mic', { deviceId: 'a' })])
    await settle()
    mixer.apply([ch('mic', { deviceId: 'a', volume: 0.5 })])
    mixer.apply([ch('mic', { deviceId: 'a', volume: 0.4 })])
    await settle()
    expect(opened).toEqual(['mic'])
  })
})
