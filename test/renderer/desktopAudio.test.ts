// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'

/**
 * System audio shares the screen-capture mechanism: audio cannot be requested
 * alone, so a screen is asked for too and its picture discarded. Without the
 * request being declared first, the browser refuses it.
 */

let bridge: BridgeStub
let requestDesktopAudio: typeof import('../../src/lib/audio/engine')['requestDesktopAudio']
let getDisplayMedia: ReturnType<typeof vi.fn>

const track = () => ({ stop: vi.fn() })

function stream(opts: { audio?: boolean } = { audio: true }) {
  const video = track()
  const audio = track()
  const videoTracks = [video]
  return {
    video, audio,
    stream: {
      getTracks: () => [video, ...(opts.audio ? [audio] : [])],
      getVideoTracks: () => videoTracks,
      getAudioTracks: () => (opts.audio ? [audio] : []),
      removeTrack: vi.fn(),
    } as unknown as MediaStream,
  }
}

beforeEach(async () => {
  vi.resetModules()
  bridge = installBridge()
  bridge.reply('list_capture_sources', [
    { id: 'screen:0:0', name: 'Entire screen', kind: 'screen', thumbnail: null, icon: null },
    { id: 'screen:1:0', name: 'Screen 2', kind: 'screen', thumbnail: null, icon: null },
  ])
  getDisplayMedia = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia }, configurable: true })
  requestDesktopAudio = (await import('../../src/lib/audio/engine')).requestDesktopAudio
})

afterEach(() => removeBridge())

describe('requestDesktopAudio', () => {
  it('declares a loopback request on a screen before asking for the stream', async () => {
    const s = stream()
    getDisplayMedia.mockResolvedValue(s.stream)

    await requestDesktopAudio()

    const prepare = bridge.calls.find((c) => c.command === 'prepare_capture')
    expect(prepare?.args).toEqual({ sourceId: 'screen:0:0', audio: true })
    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: true })
  })

  it('asks only about screens', async () => {
    getDisplayMedia.mockResolvedValue(stream().stream)
    await requestDesktopAudio()
    expect(bridge.argsFor('list_capture_sources')?.kinds).toEqual(['screen'])
  })

  it('returns the audio and discards the picture that came with it', async () => {
    const s = stream()
    getDisplayMedia.mockResolvedValue(s.stream)

    const result = await requestDesktopAudio()

    expect(s.video.stop).toHaveBeenCalled()
    expect(result.getAudioTracks()).toHaveLength(1)
    expect(s.audio.stop).not.toHaveBeenCalled()
  })

  it('fails clearly when the system provides no audio', async () => {
    const s = stream({ audio: false })
    getDisplayMedia.mockResolvedValue(s.stream)

    await expect(requestDesktopAudio()).rejects.toThrow(/did not provide system audio/i)
    expect(s.video.stop).toHaveBeenCalled()
  })

  it('fails clearly when there is no screen to attach it to', async () => {
    bridge.reply('list_capture_sources', [])
    await expect(requestDesktopAudio()).rejects.toThrow(/no screen/i)
    expect(getDisplayMedia).not.toHaveBeenCalled()
  })

  it('reports a refusal in plain words', async () => {
    getDisplayMedia.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    await expect(requestDesktopAudio()).rejects.toThrow(/permission to use the system audio was denied/i)
  })
})
