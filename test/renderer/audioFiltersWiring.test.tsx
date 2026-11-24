// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge } from '../mocks/bridge'
import { Mixer, type MixerDeps } from '../../src/host/mixer'
import { DirectMixer, type MixBlock } from '../../src/host/directMixer'
import { OUTPUT_RATE } from '../../src/host/audioInput'
import { DEFAULT_FILTERS, type AudioFilters } from '../../shared/audioFilters'
import { sanitizeSnapshot } from '../../electron/main/host/snapshot'
import type { SnapshotChannel } from '../../shared/host'

/**
 * The filters travel from the mixer channel (where they are set) through the
 * snapshot (checked by the main process) to the host's mix (where they change
 * what is recorded and streamed).
 */

const loud: AudioFilters = { ...DEFAULT_FILTERS, gainDb: 6 }

describe('the host mixer', () => {
  it('gives each open input its channel\'s filters, and new ones when they change', async () => {
    const given: AudioFilters[] = []
    const deps: MixerDeps = {
      openInput: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) as unknown as MediaStream,
      attach: () => ({ setGain: () => {}, setFilters: (f) => given.push(f), detach: () => {} }),
    }
    const mixer = new Mixer(deps)
    const ch = (filters?: AudioFilters): SnapshotChannel => ({ id: 'mic', volume: 1, muted: false, noiseSuppression: false, connected: true, deviceId: '', filters })

    mixer.apply([ch(loud)])
    await new Promise((r) => setTimeout(r, 0))
    expect(given.at(-1)).toEqual(loud)

    mixer.apply([ch({ ...DEFAULT_FILTERS, gate: { ...DEFAULT_FILTERS.gate, enabled: true } })])
    expect(given.at(-1)?.gate.enabled).toBe(true)

    mixer.apply([ch(undefined)])
    expect(given.at(-1)).toEqual(DEFAULT_FILTERS)
  })
})

describe('the mix', () => {
  function mixerWithTone(filters?: AudioFilters) {
    const blocks: MixBlock[] = []
    let now = 5000
    const mixer = new DirectMixer({ now: () => now, onBlock: (b) => blocks.push(b) })
    const input = mixer.addInput('mic', OUTPUT_RATE, 'mic')
    if (filters) input.setFilters(filters)
    for (let t = 0; t < 400; t += 10) {
      input.push({ timestampUs: (now + t) * 1000, sampleRate: OUTPUT_RATE, channels: [new Float32Array(480).fill(0.1)] }, now + t + 15)
    }
    for (let i = 0; i < 50; i++) { now += 10; mixer.pump() }
    return blocks
  }

  it('is changed by the filters, on the mix and on the microphone\'s own track', () => {
    const plain = mixerWithTone().find((b) => b.data[500] !== 0)!
    const boosted = mixerWithTone(loud).find((b) => b.data[500] !== 0)!
    expect(plain.data[500]).toBeCloseTo(0.1)
    expect(boosted.data[500]).toBeCloseTo(0.1 * Math.pow(10, 6 / 20), 3)
    expect(boosted.mic[500]).toBeCloseTo(boosted.data[500], 5)
  })

  it('is untouched with no filters', () => {
    const b = mixerWithTone(DEFAULT_FILTERS).find((x) => x.data[500] !== 0)!
    expect(b.data[500]).toBeCloseTo(0.1, 6)
  })
})

describe('the snapshot', () => {
  const snap = (filters: unknown) => sanitizeSnapshot({ base: { width: 1920, height: 1080 }, sources: [], audio: [{ id: 'mic', connected: true, filters }] })

  it('carries filters through, checked', () => {
    expect(snap(loud).audio[0].filters).toEqual(loud)
  })

  it('turns nonsense into no filters', () => {
    expect(snap('junk').audio[0].filters).toEqual(DEFAULT_FILTERS)
    expect(snap({ gainDb: 1e9 }).audio[0].filters?.gainDb).toBe(30)
  })
})

describe('the mixer channel and the filters window', () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); installBridge() })
  afterEach(() => { cleanup(); removeBridge() })

  it('remembers filters across a restart', async () => {
    const { useAudioStore } = await import('../../src/stores/audioStore')
    useAudioStore.getState().setFilters('mic', loud)
    vi.resetModules()
    const again = (await import('../../src/stores/audioStore')).useAudioStore
    expect(again.getState().channels.find((c) => c.id === 'mic')?.filters).toEqual(loud)
  })

  it('puts them in what the host is sent', async () => {
    const { useAudioStore } = await import('../../src/stores/audioStore')
    const { buildSnapshot } = await import('../../src/lib/hostSnapshot')
    useAudioStore.getState().setFilters('mic', loud)
    const s = useAudioStore.getState()
    const snapshot = buildSnapshot({ sources: [], channels: s.channels, connected: ['mic'], devices: {}, base: { width: 1920, height: 1080 } } as never)
    expect(snapshot.audio.find((c) => c.id === 'mic')?.filters).toEqual(loud)
  })

  it('applies a change straight away, and Reset clears it', async () => {
    const { AudioFiltersModal } = await import('../../src/components/modals/AudioFiltersModal')
    const { useUIStore } = await import('../../src/stores/uiStore')
    const { useAudioStore } = await import('../../src/stores/audioStore')
    render(<AudioFiltersModal />)
    await act(async () => { useUIStore.getState().openModal('audio-filters', { channelId: 'mic' }) })

    expect(await screen.findByText(/Audio Filters: Mic/)).toBeInTheDocument()
    const mic = () => useAudioStore.getState().channels.find((c) => c.id === 'mic')!.filters

    await userEvent.click(screen.getByRole('checkbox', { name: 'Noise Gate on' }))
    expect(mic().gate.enabled).toBe(true)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Compressor on' }))
    expect(mic().compressor.enabled).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(mic()).toEqual(DEFAULT_FILTERS)
  })

  it('keeps the gate\'s settings greyed out until it is switched on', async () => {
    const { AudioFiltersModal } = await import('../../src/components/modals/AudioFiltersModal')
    const { useUIStore } = await import('../../src/stores/uiStore')
    render(<AudioFiltersModal />)
    await act(async () => { useUIStore.getState().openModal('audio-filters', { channelId: 'mic' }) })
    expect((await screen.findByRole('slider', { name: 'Open above' })).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('slider', { name: 'Gain' }).hasAttribute('disabled')).toBe(false)
  })
})
