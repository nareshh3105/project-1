// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge } from '../mocks/bridge'
import { PRESETS, presetOf, presetPatch } from '../../src/lib/presets'
import { struggleMessage } from '../../src/lib/health'
import { STANDARD_RESOLUTIONS } from '../../src/types/common'

/**
 * A computer that cannot keep up should say so, with a way out: the status bar
 * shows measured rates (not fixed ones), the warning names what to try, and one
 * choice in Settings lightens the load.
 */

let useOutputStore: typeof import('../../src/stores/outputStore')['useOutputStore']
let useUIStore: typeof import('../../src/stores/uiStore')['useUIStore']
let useSettingsStore: typeof import('../../src/stores/settingsStore')['useSettingsStore']
let StatusBar: typeof import('../../src/components/layout/StatusBar')['StatusBar']
let SettingsModal: typeof import('../../src/components/modals/SettingsModal')['SettingsModal']

const stats = (over: Partial<import('../../src/stores/uiStore').RuntimeStats> = {}) => ({
  cpuPercent: 20, memoryMb: 1000, gpuPercent: 0, renderFps: 59.4, encodeFps: 59.4,
  skippedFramesRender: 0, skippedFramesEncode: 7, outputBitrateBps: 6_000_000, networkBps: 0, diskWriteMbps: 0, ...over,
})

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  installBridge()
  useOutputStore = (await import('../../src/stores/outputStore')).useOutputStore
  useUIStore = (await import('../../src/stores/uiStore')).useUIStore
  useSettingsStore = (await import('../../src/stores/settingsStore')).useSettingsStore
  StatusBar = (await import('../../src/components/layout/StatusBar')).StatusBar
  SettingsModal = (await import('../../src/components/modals/SettingsModal')).SettingsModal
})
afterEach(() => { cleanup(); removeBridge() })

describe('presets', () => {
  it('offers lighter and heavier choices', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['quality', 'balanced', 'performance', 'light'])
    // Each is no heavier than the one before.
    const cost = (p: (typeof PRESETS)[number]) => p.width * p.height * p.fps
    for (let i = 1; i < PRESETS.length; i++) expect(cost(PRESETS[i])).toBeLessThan(cost(PRESETS[i - 1]))
  })

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s sets its size and frame rate', (id, p) => {
    const patch = presetPatch(id)
    expect([patch.outputResolution.width, patch.outputResolution.height, patch.fps]).toEqual([p.width, p.height, p.fps])
    expect([patch.fpsNumerator, patch.fpsDenominator]).toEqual([p.fps, 1])
  })

  it('uses the standard resolution entries, with their labels', () => {
    expect(presetPatch('performance').outputResolution).toBe(STANDARD_RESOLUTIONS.find((r) => r.width === 1280))
  })

  it.each(PRESETS.map((p) => p.id))('is recognised again after being applied: %s', (id) => {
    expect(presetOf(presetPatch(id))).toBe(id)
  })

  it('is not recognised for a mix of its own', () => {
    expect(presetOf({ outputResolution: { width: 1920, height: 1080, label: '' }, fps: 48 })).toBeNull()
    expect(presetOf({ outputResolution: { width: 1000, height: 1000, label: '' }, fps: 30 })).toBeNull()
    // The right width and rate with the wrong height is not the preset either.
    expect(presetOf({ outputResolution: { width: 1920, height: 720, label: '' }, fps: 30 })).toBeNull()
  })
})

describe('the warning', () => {
  it('names the output, the share dropped, and what to try', () => {
    const m = struggleMessage('recording', 0.32)
    expect(m).toContain('recording')
    expect(m).toContain('32%')
    expect(m).toMatch(/Performance preset/)
    expect(m).toMatch(/frame rate/)
  })

  it.each([['streaming', 'stream'], ['replay', 'replay buffer'], ['virtualCamera', 'virtual camera']])('calls %s a %s', (kind, name) => {
    expect(struggleMessage(kind, 0.2)).toContain(name)
  })

  it('never says 0%', () => {
    expect(struggleMessage('recording', 0.001)).toContain('1%')
  })

  it('copes with an output it does not know', () => {
    expect(struggleMessage('mystery', 0.5)).toContain('output')
  })
})

describe('what the output store remembers', () => {
  it('notes which outputs are behind', () => {
    useOutputStore.getState().setStruggling('recording', true)
    expect(useOutputStore.getState().struggling).toEqual({ recording: true })
    useOutputStore.getState().setStruggling('recording', false)
    expect(useOutputStore.getState().struggling).toEqual({})
  })

  it.each([
    ['recording', () => useOutputStore.getState().setRecordingStatus(false, null)],
    ['streaming', () => useOutputStore.getState().setStreamingStatus(false)],
    ['replay', () => useOutputStore.getState().setReplayActive(false)],
    ['virtualCamera', () => useOutputStore.getState().setVirtualCameraStatus(false, null)],
  ])('forgets that %s was behind once it stops', (kind, stop) => {
    useOutputStore.getState().setStruggling(kind, true)
    stop()
    expect(useOutputStore.getState().struggling).toEqual({})
  })

  it('does not forget while the output keeps running', () => {
    useOutputStore.getState().setStruggling('recording', true)
    useOutputStore.getState().setRecordingStatus(true, 'x.mkv')
    expect(useOutputStore.getState().struggling).toEqual({ recording: true })
  })
})

describe('the status bar', () => {
  const readout = (label: string) =>
    screen.getByText(`${label}:`).parentElement!.textContent!.replace(`${label}:`, '')

  it('shows the measured rates while an output runs', () => {
    useUIStore.setState({ stats: stats() })
    useOutputStore.getState().setRecordingStatus(true, 'x.mkv')
    render(<StatusBar />)

    expect(readout('FPS')).toBe('59.4')
    expect(readout('Dropped')).toBe('7')
    expect(readout('Bitrate')).toMatch(/6/)
  })

  it('shows dashes, not made-up numbers, when nothing is running', () => {
    useUIStore.setState({ stats: stats({ renderFps: 0, skippedFramesEncode: 0, outputBitrateBps: 0 }) })
    render(<StatusBar />)

    expect(readout('FPS')).toBe('–')
    expect(readout('Dropped')).toBe('–')
    expect(readout('Bitrate')).toBe('–')
  })

  it('still shows processor and memory when nothing is running', () => {
    useUIStore.setState({ stats: stats() })
    render(<StatusBar />)
    expect(readout('CPU')).toBe('20.0%')
  })

  it('marks the dropped count when an output is behind', () => {
    useUIStore.setState({ stats: stats() })
    useOutputStore.getState().setRecordingStatus(true, 'x.mkv')
    useOutputStore.getState().setStruggling('recording', true)
    render(<StatusBar />)
    expect(screen.getByText('7').className).toMatch(/danger/)
  })

  it('does not mark it when the output is keeping up', () => {
    useUIStore.setState({ stats: stats() })
    useOutputStore.getState().setRecordingStatus(true, 'x.mkv')
    render(<StatusBar />)
    expect(screen.getByText('7').className).not.toMatch(/danger/)
  })

  it('counts a replay buffer or virtual camera as an output running', () => {
    useUIStore.setState({ stats: stats() })
    useOutputStore.getState().setReplayActive(true)
    render(<StatusBar />)
    expect(readout('FPS')).toBe('59.4')
  })
})

describe('the preset in Settings → Output', () => {
  async function openOutputTab() {
    render(<SettingsModal />)
    await act(async () => { useUIStore.getState().openModal('settings') })
    await userEvent.click(await screen.findByText('Output'))
  }
  const select = () => screen.getByRole('combobox', { name: 'Preset' }) as HTMLSelectElement

  it('shows the preset that matches the current video settings', async () => {
    useSettingsStore.getState().updateVideo(presetPatch('balanced'))
    await openOutputTab()
    expect(select().value).toBe('balanced')
  })

  it('says custom for a mix of its own, and keeps that visible', async () => {
    useSettingsStore.getState().updateVideo({ fps: 48 })
    await openOutputTab()
    expect(select().value).toBe('custom')
    expect(within(select()).getByRole('option', { name: /custom/i })).toBeInTheDocument()
  })

  it('applies a choice to the video settings only when OK is pressed', async () => {
    await openOutputTab()
    await userEvent.selectOptions(select(), 'light')
    expect(useSettingsStore.getState().video.outputResolution.width).not.toBe(852)

    await userEvent.click(screen.getByRole('button', { name: /^ok$/i }))
    expect(useSettingsStore.getState().video.outputResolution.width).toBe(852)
    expect(useSettingsStore.getState().video.fps).toBe(30)
  })

  it('throws the choice away on Cancel', async () => {
    useSettingsStore.getState().updateVideo(presetPatch('quality'))
    await openOutputTab()
    await userEvent.selectOptions(select(), 'light')
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(useSettingsStore.getState().video.fps).toBe(60)
  })

  it('explains when to use it', async () => {
    await openOutputTab()
    expect(screen.getByText(/dropped frames/i)).toBeInTheDocument()
  })
})
