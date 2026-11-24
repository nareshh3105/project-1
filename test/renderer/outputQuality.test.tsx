// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge } from '../mocks/bridge'
import { sizeFor, parseQuality, SAME_AS_VIDEO, describeQuality } from '../../src/lib/outputQuality'
import { outputParams } from '../../src/lib/hostSnapshot'
import { DEFAULT_RECORDING, DEFAULT_VIDEO } from '../../src/stores/settingsStore'

/**
 * A recording and a stream can each have their own size, frame rate and (for
 * the stream) bitrate: a 1080p file for editing, a 720p stream a home upload carries.
 */

const video = { ...DEFAULT_VIDEO, outputResolution: { width: 1920, height: 1080 } as never, fps: 60 as const }
const settings = (over: Partial<typeof DEFAULT_RECORDING> = {}) => ({ video, recording: { ...DEFAULT_RECORDING, ...over } })

describe('sizeFor', () => {
  it('keeps the Video tab size for 0 or its own height', () => {
    expect(sizeFor(0, { width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 })
    expect(sizeFor(1080, { width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 })
  })

  it('keeps the shape: 16:9 at 720p is 1280x720', () => {
    expect(sizeFor(720, { width: 1920, height: 1080 })).toEqual({ width: 1280, height: 720 })
  })

  it('keeps another shape too, with even sides', () => {
    expect(sizeFor(720, { width: 1920, height: 1200 })).toEqual({ width: 1152, height: 720 })
    expect(sizeFor(480, { width: 1920, height: 1080 })).toEqual({ width: 854, height: 480 })
  })

  it('can go up as well as down', () => {
    expect(sizeFor(1080, { width: 1280, height: 720 })).toEqual({ width: 1920, height: 1080 })
  })
})

describe('parseQuality', () => {
  it('is the Video tab for nothing stored', () => {
    expect(parseQuality(undefined)).toEqual(SAME_AS_VIDEO)
    expect(parseQuality('junk')).toEqual(SAME_AS_VIDEO)
  })

  it('keeps sensible values', () => {
    expect(parseQuality({ height: 720, fps: 30, videoBitrateKbps: 4000 })).toEqual({ height: 720, fps: 30, videoBitrateKbps: 4000 })
  })

  it.each([
    [{ height: 50 }, 'height', 0], [{ height: 99999 }, 'height', 0], [{ height: 720.5 }, 'height', 0], [{ height: '720' }, 'height', 0],
    [{ fps: 0.5 }, 'fps', 0], [{ fps: 500 }, 'fps', 0], [{ fps: -1 }, 'fps', 0],
    [{ videoBitrateKbps: -5 }, 'videoBitrateKbps', -1], [{ videoBitrateKbps: 1e9 }, 'videoBitrateKbps', -1],
  ] as const)('replaces the odd value in %j', (raw, field, expected) => {
    expect(parseQuality(raw)[field]).toBe(expected)
  })
})

describe('what each output is made at', () => {
  it('follows the Video tab when nothing is chosen', () => {
    for (const kind of ['recording', 'streaming', 'replay'] as const) {
      expect(outputParams(settings(), kind)).toMatchObject({ width: 1920, height: 1080, fps: 60 })
    }
  })

  it('makes a 1080p60 recording and a 720p30 stream at the same time', () => {
    const s = settings({ streamQuality: { height: 720, fps: 30, videoBitrateKbps: 4000 } })
    expect(outputParams(s, 'recording')).toMatchObject({ width: 1920, height: 1080, fps: 60 })
    expect(outputParams(s, 'streaming')).toMatchObject({ width: 1280, height: 720, fps: 30, videoBitrate: 4_000_000 })
  })

  it('gives the recording its own size without touching the stream', () => {
    const s = settings({ recordQuality: { height: 720, fps: 30, videoBitrateKbps: -1 } })
    expect(outputParams(s, 'recording')).toMatchObject({ width: 1280, height: 720, fps: 30 })
    expect(outputParams(s, 'streaming')).toMatchObject({ width: 1920, height: 1080, fps: 60 })
  })

  it('leaves the replay buffer on the Video tab', () => {
    const s = settings({ recordQuality: { height: 720, fps: 30, videoBitrateKbps: -1 }, streamQuality: { height: 480, fps: 30, videoBitrateKbps: 0 } })
    expect(outputParams(s, 'replay')).toMatchObject({ width: 1920, height: 1080, fps: 60 })
  })

  it('uses the recording bitrate for a stream set to "same as above"', () => {
    const s = settings({ videoBitrateKbps: 8000, streamQuality: { height: 0, fps: 0, videoBitrateKbps: -1 } })
    expect(outputParams(s, 'streaming').videoBitrate).toBe(8_000_000)
  })

  it('picks a bitrate to suit the stream\'s own size when set to automatic', () => {
    const s = settings({ videoBitrateKbps: 20000, streamQuality: { height: 720, fps: 30, videoBitrateKbps: 0 } })
    // 1280x720x30x0.097 = 2.68 Mbps, rounded to 0.1 Mbps.
    expect(outputParams(s, 'streaming').videoBitrate).toBe(2_700_000)
  })

  it('suits an automatic recording bitrate to the recording\'s own size', () => {
    const s = settings({ videoBitrateKbps: 0, recordQuality: { height: 720, fps: 30, videoBitrateKbps: -1 } })
    expect(outputParams(s, 'recording').videoBitrate).toBe(2_700_000)
  })

  it('copes with settings saved before this existed', () => {
    const old = { video, recording: { ...DEFAULT_RECORDING, recordQuality: undefined, streamQuality: undefined } as never }
    expect(outputParams(old, 'streaming')).toMatchObject({ width: 1920, height: 1080, fps: 60 })
  })

  it('says what a choice comes to', () => {
    expect(describeQuality({ height: 720, fps: 0, videoBitrateKbps: -1 }, { width: 1920, height: 1080 }, 60)).toBe('1280x720 at 60 fps')
  })
})

describe('the settings', () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); installBridge() })
  afterEach(() => { cleanup(); removeBridge() })

  it('reads a stored choice back, and a broken one as the default', async () => {
    localStorage.setItem('cb:settings', JSON.stringify({ recording: { streamQuality: { height: 720, fps: 30, videoBitrateKbps: 4000 }, recordQuality: { height: 'big' } } }))
    const { useSettingsStore } = await import('../../src/stores/settingsStore')
    expect(useSettingsStore.getState().recording.streamQuality).toEqual({ height: 720, fps: 30, videoBitrateKbps: 4000 })
    expect(useSettingsStore.getState().recording.recordQuality).toEqual(SAME_AS_VIDEO)
  })

  it('shows Recording quality and Streaming quality in Settings, Output, and saves a choice on OK', async () => {
    const { SettingsModal } = await import('../../src/components/modals/SettingsModal')
    const { useUIStore } = await import('../../src/stores/uiStore')
    const { useSettingsStore } = await import('../../src/stores/settingsStore')
    render(<SettingsModal />)
    await act(async () => { useUIStore.getState().openModal('settings') })
    await userEvent.click(await screen.findByText('Output'))

    expect(screen.getByText('Recording quality')).toBeInTheDocument()
    expect(screen.getByText('Streaming quality')).toBeInTheDocument()

    const resolutions = screen.getAllByRole('combobox', { name: 'Resolution' })
    expect(resolutions).toHaveLength(2)
    await userEvent.selectOptions(resolutions[1], '480')

    await userEvent.click(screen.getByRole('button', { name: /^ok$/i }))
    expect(useSettingsStore.getState().recording.streamQuality.height).toBe(480)
    expect(useSettingsStore.getState().recording.recordQuality.height).toBe(0)
  })
})
