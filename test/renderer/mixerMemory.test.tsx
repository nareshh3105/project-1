// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge } from '../mocks/bridge'

/**
 * An installed mixer comes back as it was left: faders where they were, mutes
 * kept, and the inputs that were connected connect again without being asked.
 */

const requestMicrophone = vi.fn()
const requestDesktopAudio = vi.fn()
const attach = vi.fn()
const detach = vi.fn()

vi.mock('../../src/lib/audio/engine', () => ({
  AudioEngine: class {
    start() {}
    attach(...a: unknown[]) { attach(...a) }
    detach(...a: unknown[]) { detach(...a) }
    async dispose() {}
  },
  requestMicrophone: (...a: unknown[]) => requestMicrophone(...a),
  requestDesktopAudio: (...a: unknown[]) => requestDesktopAudio(...a),
}))

const stream = () => {
  const track = { stop: vi.fn() }
  return { getTracks: () => [track] } as unknown as MediaStream
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const KEY = 'cb:mixer'

type Store = typeof import('../../src/stores/audioStore')
let audio: Store
let Panel: typeof import('../../src/components/panels/AudioMixerPanel')['AudioMixerPanel']

async function load() {
  vi.resetModules()
  audio = await import('../../src/stores/audioStore')
  Panel = (await import('../../src/components/panels/AudioMixerPanel')).AudioMixerPanel
}

beforeEach(async () => {
  localStorage.clear()
  installBridge()
  requestMicrophone.mockReset().mockImplementation(async () => stream())
  requestDesktopAudio.mockReset().mockImplementation(async () => stream())
  attach.mockReset(); detach.mockReset()
  await load()
})
afterEach(() => { cleanup(); removeBridge() })

const volumeOf = (id: string) => audio.useAudioStore.getState().channels.find((c) => c.id === id)!.volume

describe('faders and mutes', () => {
  it('come back after a restart', async () => {
    audio.useAudioStore.getState().setVolume('mic', 0.4)
    audio.useAudioStore.getState().setMuted('desktop', true)
    audio.useAudioStore.getState().setNoiseSuppression('mic', true)

    await load()
    const channels = audio.useAudioStore.getState().channels
    expect(channels.find((c) => c.id === 'mic')).toMatchObject({ volume: 0.4, noiseSuppression: true, muted: false })
    expect(channels.find((c) => c.id === 'desktop')).toMatchObject({ volume: 1, muted: true })
  })

  it('start at full volume with nothing remembered', () => {
    expect(audio.useAudioStore.getState().channels.every((c) => c.volume === 1 && !c.muted)).toBe(true)
  })

  it.each([
    ['not JSON', 'oops'],
    ['null', 'null'],
    ['an array', '[]'],
    ['the wrong shape', '{"channels":3,"inputs":"mic"}'],
  ])('ignore stored data that is %s', async (_n, raw) => {
    localStorage.setItem(KEY, raw)
    await load()
    expect(audio.useAudioStore.getState().channels.every((c) => c.volume === 1)).toBe(true)
    expect(audio.rememberedInputs()).toEqual([])
  })

  it('clamp an impossible volume instead of trusting it', async () => {
    localStorage.setItem(KEY, JSON.stringify({ channels: { mic: { volume: 40 }, desktop: { volume: -3 }, music: { volume: 'loud' } }, inputs: [] }))
    await load()
    expect([volumeOf('mic'), volumeOf('desktop'), volumeOf('music')]).toEqual([1, 0, 1])
  })

  it('keep each channel separately', async () => {
    audio.useAudioStore.getState().setVolume('mic', 0.2)
    audio.useAudioStore.getState().setVolume('desktop', 0.9)
    await load()
    expect([volumeOf('mic'), volumeOf('desktop')]).toEqual([0.2, 0.9])
  })
})

describe('inputs', () => {
  it('are remembered when connected and forgotten when disconnected', () => {
    audio.rememberInput('mic', true)
    audio.rememberInput('desktop', true)
    expect(audio.rememberedInputs().sort()).toEqual(['desktop', 'mic'])

    audio.rememberInput('mic', false)
    expect(audio.rememberedInputs()).toEqual(['desktop'])
  })

  it('do not pile up duplicates', () => {
    audio.rememberInput('mic', true)
    audio.rememberInput('mic', true)
    expect(audio.rememberedInputs()).toEqual(['mic'])
  })

  it('do not disturb the saved faders', () => {
    audio.useAudioStore.getState().setVolume('mic', 0.3)
    audio.rememberInput('mic', true)
    const saved = JSON.parse(localStorage.getItem(KEY)!)
    expect(saved.channels.mic.volume).toBe(0.3)
  })
})

describe('reconnecting when the mixer opens', () => {
  it('connects what was connected last time, without a click', async () => {
    audio.rememberInput('mic', true)
    audio.rememberInput('desktop', true)

    render(<Panel />)
    await settle()

    expect(requestMicrophone).toHaveBeenCalledTimes(1)
    expect(requestDesktopAudio).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledTimes(2)
    expect([...audio.useAudioStore.getState().connected].sort()).toEqual(['desktop', 'mic'])
  })

  it('connects nothing on a first run', async () => {
    render(<Panel />)
    await settle()
    expect(requestMicrophone).not.toHaveBeenCalled()
    expect(requestDesktopAudio).not.toHaveBeenCalled()
  })

  it('says so on the button when an input cannot be reconnected', async () => {
    requestMicrophone.mockRejectedValue(new Error('No microphone device was found.'))
    audio.rememberInput('mic', true)

    render(<Panel />)
    await settle()

    expect(audio.useAudioStore.getState().connected).not.toContain('mic')
    expect(audio.useAudioStore.getState().errors.mic).toBe('No microphone device was found.')
  })

  it('does not let one failing input stop the other connecting', async () => {
    requestMicrophone.mockRejectedValue(new Error('busy'))
    audio.rememberInput('mic', true)
    audio.rememberInput('desktop', true)

    render(<Panel />)
    await settle()

    expect(audio.useAudioStore.getState().connected).toEqual(['desktop'])
  })

  it('releases an input that arrives after the panel closed', async () => {
    let finish!: (s: MediaStream) => void
    const late = stream()
    requestMicrophone.mockImplementation(() => new Promise<MediaStream>((r) => { finish = r }))
    audio.rememberInput('mic', true)

    const view = render(<Panel />)
    await settle()
    view.unmount()
    await act(async () => { finish(late); await new Promise((r) => setTimeout(r, 0)) })

    expect(attach).not.toHaveBeenCalled()
    expect(late.getTracks()[0].stop).toHaveBeenCalled()
  })
})

describe('clicks on the connect buttons', () => {
  it('remember a connection', async () => {
    const user = userEvent.setup()
    render(<Panel />)
    await user.click(screen.getByRole('button', { name: /^mic$/i }))
    await settle()

    expect(audio.rememberedInputs()).toEqual(['mic'])
  })

  it('forget a disconnection, so it stays off next time', async () => {
    const user = userEvent.setup()
    audio.rememberInput('mic', true)
    render(<Panel />)
    await settle()

    await user.click(screen.getByRole('button', { name: /^mic$/i }))
    await settle()

    expect(detach).toHaveBeenCalledWith('mic')
    expect(audio.rememberedInputs()).toEqual([])
  })
})
