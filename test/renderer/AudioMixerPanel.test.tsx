// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge } from '../mocks/bridge'
import { SILENT } from '../../src/lib/audio/levels'

/**
 * The mixer rows. Every control has to stay reachable: the previous vertical
 * strips stacked six elements into a short dock panel and pushed the channel
 * name and part of the noise-suppression button out of view.
 */

let AudioMixerPanel: typeof import('../../src/components/panels/AudioMixerPanel')['AudioMixerPanel']
let useAudioStore: typeof import('../../src/stores/audioStore')['useAudioStore']

// The panel builds an AudioEngine on mount; none of these tests exercise real
// audio, so it is stubbed down to the interface the panel actually calls.
vi.mock('../../src/lib/audio/engine', () => ({
  AudioEngine: class {
    start() {}
    attach() {}
    detach() {}
    async dispose() {}
  },
  requestMicrophone: vi.fn(async () => ({}) as MediaStream),
  requestDesktopAudio: vi.fn(async () => ({}) as MediaStream),
}))

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  installBridge()
  AudioMixerPanel = (await import('../../src/components/panels/AudioMixerPanel')).AudioMixerPanel
  useAudioStore = (await import('../../src/stores/audioStore')).useAudioStore
})

afterEach(() => {
  cleanup()
  removeBridge()
  vi.useRealTimers()
})

const channelIds = () => useAudioStore.getState().channels.map((c) => c.id)

function setLevels(id: string, levels: Partial<typeof SILENT>) {
  act(() => {
    useAudioStore.getState().setAllLevels({
      [id]: { ...SILENT, ...levels },
    } as Record<string, typeof SILENT>)
  })
}

describe('every control stays reachable', () => {
  it('names each channel', () => {
    render(<AudioMixerPanel />)

    // Scoped to each row's fader, because a channel name such as "Desktop" is
    // also the label of the connect button in the header.
    for (const channel of useAudioStore.getState().channels) {
      expect(screen.getByLabelText(`${channel.name} volume`)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Mute ${channel.name}` })).toBeInTheDocument()
    }
  })

  it('gives every channel a fader, a mute and a noise-suppression toggle', () => {
    render(<AudioMixerPanel />)
    const count = useAudioStore.getState().channels.length

    expect(screen.getAllByRole('slider')).toHaveLength(count)
    expect(screen.getAllByRole('button', { name: /mute/i })).toHaveLength(count)
    expect(screen.getAllByRole('button', { name: /noise suppression/i })).toHaveLength(count)
  })

  it('mutes a channel and says so', async () => {
    render(<AudioMixerPanel />)
    const [first] = useAudioStore.getState().channels

    await userEvent.click(screen.getByRole('button', { name: `Mute ${first.name}` }))

    expect(useAudioStore.getState().channels[0].muted).toBe(true)
    expect(screen.getByRole('button', { name: `Unmute ${first.name}` })).toHaveAttribute(
      'aria-pressed', 'true',
    )
  })

  it('toggles noise suppression', async () => {
    render(<AudioMixerPanel />)
    const [first] = useAudioStore.getState().channels

    await userEvent.click(
      screen.getByRole('button', { name: new RegExp(`noise suppression .* ${first.name}`, 'i') }),
    )

    expect(useAudioStore.getState().channels[0].noiseSuppression).toBe(true)
  })
})

describe('level readout', () => {
  it('shows silence as −∞ rather than a very negative number', () => {
    render(<AudioMixerPanel />)
    expect(screen.getAllByText('−∞').length).toBeGreaterThan(0)
  })

  it('reports the louder of the two channels', () => {
    render(<AudioMixerPanel />)
    const [id] = channelIds()

    setLevels(id, { rmsL: -24.5, rmsR: -30 })

    expect(screen.getByText('-24.5')).toBeInTheDocument()
  })
})

/**
 * The regression. The hold was written straight to a ref during render, with a
 * timer that reassigned the same captured value — so it only ever rose. One
 * loud moment pinned the marker at that level for the rest of the session,
 * which is exactly the reading a peak meter exists to disprove.
 */
describe('peak hold', () => {
  // The strips are vertical: the hold marker is a 2px-tall rule positioned
  // from the bottom of the meter.
  const peakMarkers = (container: HTMLElement) =>
    container.querySelectorAll('[style*="height: 2px"]')

  /** The marker's position is `calc(<pct>% - 1px)`; pull the percentage out. */
  const markerPct = (container: HTMLElement): number => {
    const el = peakMarkers(container)[0] as HTMLElement | undefined
    const match = el?.style.bottom.match(/([\d.]+)%/)
    return match ? parseFloat(match[1]) : NaN
  }

  it('holds a peak above the current signal', () => {
    const { container } = render(<AudioMixerPanel />)
    const [id] = channelIds()

    setLevels(id, { peakL: -6, rmsL: -6 })
    setLevels(id, { peakL: -40, rmsL: -40 })

    // The marker is still drawn, above where the signal now sits.
    expect(peakMarkers(container).length).toBeGreaterThan(0)
  })

  it('lets the held peak fall back towards the signal', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { container } = render(<AudioMixerPanel />)
    const [id] = channelIds()

    setLevels(id, { peakL: -3, rmsL: -3 })
    const heldAtPeak = markerPct(container)
    expect(Number.isNaN(heldAtPeak)).toBe(false)

    // A second of quiet at 20 dB/s should drop the hold by about 20 dB.
    for (let frame = 0; frame < 60; frame++) {
      act(() => { vi.advanceTimersByTime(16) })
      setLevels(id, { peakL: -50 + frame * 1e-6, rmsL: -50 })
    }

    const heldAfter = markerPct(container)
    expect(heldAfter).toBeLessThan(heldAtPeak)
  })
})
