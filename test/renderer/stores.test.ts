// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { STORAGE_KEYS } from '../../src/lib/constants'

/**
 * The stores hold the state the interface renders from. Most are thin, but the
 * output store drives the recording indicator and elapsed timer, and the UI
 * store persists the dock layout — both are user-visible if they drift.
 */

async function fresh() {
  vi.resetModules()
  localStorage.clear()
  return {
    output: (await import('../../src/stores/outputStore')).useOutputStore,
    ui: (await import('../../src/stores/uiStore')).useUIStore,
    audio: (await import('../../src/stores/audioStore')).useAudioStore,
    filters: (await import('../../src/stores/filterStore')).useFilterStore,
  }
}

let s: Awaited<ReturnType<typeof fresh>>

beforeEach(async () => {
  s = await fresh()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('outputStore — recording', () => {
  it('starts idle', () => {
    const { recording } = s.output.getState()
    expect(recording.active).toBe(false)
    expect(recording.filePath).toBeNull()
  })

  it('records the file path when a recording starts', () => {
    s.output.getState().setRecordingStatus(true, 'C:/Videos/a.mkv')
    expect(s.output.getState().recording.filePath).toBe('C:/Videos/a.mkv')
  })

  it('stamps a start time so the timer has an origin', () => {
    s.output.getState().setRecordingStatus(true, 'a.mkv')
    expect(s.output.getState().recording.startedAt).toBeTypeOf('number')
  })

  it('clears the start time and path on stop', () => {
    s.output.getState().setRecordingStatus(true, 'a.mkv')
    s.output.getState().setRecordingStatus(false, null)

    const { recording } = s.output.getState()
    expect(recording.startedAt).toBeNull()
    expect(recording.filePath).toBeNull()
  })

  it('resets elapsed time between recordings', () => {
    vi.useFakeTimers()
    s.output.getState().setRecordingStatus(true, 'a.mkv')
    vi.advanceTimersByTime(5000)
    s.output.getState().tickElapsed()
    expect(s.output.getState().recording.elapsed).toBe(5)

    s.output.getState().setRecordingStatus(false, null)
    s.output.getState().setRecordingStatus(true, 'b.mkv')

    expect(s.output.getState().recording.elapsed).toBe(0)
  })
})

describe('outputStore — elapsed timer', () => {
  beforeEach(() => vi.useFakeTimers())

  it('counts whole seconds since the start', () => {
    s.output.getState().setRecordingStatus(true, 'a.mkv')
    vi.advanceTimersByTime(65_000)
    s.output.getState().tickElapsed()

    expect(s.output.getState().recording.elapsed).toBe(65)
  })

  it('does not advance while idle', () => {
    vi.advanceTimersByTime(10_000)
    s.output.getState().tickElapsed()
    expect(s.output.getState().recording.elapsed).toBe(0)
  })

  it('tracks recording and streaming independently', () => {
    s.output.getState().setRecordingStatus(true, 'a.mkv')
    vi.advanceTimersByTime(10_000)
    s.output.getState().setStreamingStatus(true)
    vi.advanceTimersByTime(5_000)
    s.output.getState().tickElapsed()

    const { recording, streaming } = s.output.getState()
    expect(recording.elapsed).toBe(15)
    expect(streaming.elapsed).toBe(5)
  })
})

describe('outputStore — stream settings', () => {
  it('stores the RTMP URL and key', () => {
    s.output.getState().setStreamSettings('rtmp://live/app', 'secret')
    const { stream } = s.output.getState()

    expect(stream.rtmpUrl).toBe('rtmp://live/app')
    expect(stream.streamKey).toBe('secret')
  })

  it('persists them for the next session', async () => {
    s.output.getState().setStreamSettings('rtmp://live/app', 'secret')

    vi.resetModules()
    const { useOutputStore } = await import('../../src/stores/outputStore')

    expect(useOutputStore.getState().stream.rtmpUrl).toBe('rtmp://live/app')
  })

  it('falls back to empty settings when storage is corrupt', async () => {
    localStorage.setItem('cb:stream', 'not json')
    vi.resetModules()

    const { useOutputStore } = await import('../../src/stores/outputStore')

    expect(useOutputStore.getState().stream).toEqual({ rtmpUrl: '', streamKey: '' })
  })
})

describe('outputStore — other outputs', () => {
  it('tracks replay buffer state', () => {
    s.output.getState().setReplayActive(true)
    expect(s.output.getState().replayBuffer.active).toBe(true)
  })

  it('keeps the virtual camera URL alongside its state', () => {
    s.output.getState().setVirtualCameraStatus(true, 'udp://127.0.0.1:12345')
    expect(s.output.getState().virtualCamera.url).toBe('udp://127.0.0.1:12345')
  })

  it('clears the URL when the virtual camera stops', () => {
    s.output.getState().setVirtualCameraStatus(true, 'udp://127.0.0.1:12345')
    s.output.getState().setVirtualCameraStatus(false, null)
    expect(s.output.getState().virtualCamera.url).toBeNull()
  })

  // null means "not checked yet", which the interface shows differently from a
  // confirmed absence.
  it('starts with ffmpeg availability unknown rather than false', () => {
    expect(s.output.getState().ffmpegAvailable).toBeNull()
  })

  it('records the availability check result', () => {
    s.output.getState().setFfmpegAvailable(false)
    expect(s.output.getState().ffmpegAvailable).toBe(false)
  })
})

describe('uiStore', () => {
  it('opens and closes a modal', () => {
    s.ui.getState().openModal('settings')
    expect(s.ui.getState().modal?.type).toBe('settings')

    s.ui.getState().closeModal()
    expect(s.ui.getState().modal).toBeNull()
  })

  it('carries a payload with the modal', () => {
    s.ui.getState().openModal('filters', { sourceId: 'abc' })
    expect(s.ui.getState().modal?.payload).toEqual({ sourceId: 'abc' })
  })

  it('toggles studio mode', () => {
    expect(s.ui.getState().studioMode).toBe(false)
    s.ui.getState().toggleStudioMode()
    expect(s.ui.getState().studioMode).toBe(true)
  })

  it('toggles the fullscreen preview overlay', () => {
    s.ui.getState().toggleFullscreenPreview()
    expect(s.ui.getState().fullscreenPreview).toBe(true)

    s.ui.getState().setFullscreenPreview(false)
    expect(s.ui.getState().fullscreenPreview).toBe(false)
  })

  it('persists the dock layout', () => {
    s.ui.getState().setLayoutJson('{"layout":1}')
    expect(localStorage.getItem(STORAGE_KEYS.LAYOUT)).toBe('{"layout":1}')
  })

  it('clears the stored layout on reset', () => {
    s.ui.getState().setLayoutJson('{"layout":1}')
    s.ui.getState().resetLayout()

    expect(s.ui.getState().layoutJson).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.LAYOUT)).toBeNull()
  })

  it('restores a persisted layout on reload', async () => {
    s.ui.getState().setLayoutJson('{"layout":2}')

    vi.resetModules()
    const { useUIStore } = await import('../../src/stores/uiStore')

    expect(useUIStore.getState().layoutJson).toBe('{"layout":2}')
  })
})

describe('audioStore', () => {
  it('provides the four mixer channels', () => {
    expect(s.audio.getState().channels.map((c) => c.id)).toEqual([
      'desktop', 'mic', 'browser', 'music',
    ])
  })

  it('starts every channel unmuted at full volume', () => {
    for (const ch of s.audio.getState().channels) {
      expect(ch.volume).toBe(1)
      expect(ch.muted).toBe(false)
      expect(ch.noiseSuppression).toBe(false)
    }
  })

  it('changes one channel without touching the others', () => {
    s.audio.getState().setVolume('mic', 0.4)

    const channels = s.audio.getState().channels
    expect(channels.find((c) => c.id === 'mic')!.volume).toBe(0.4)
    expect(channels.find((c) => c.id === 'desktop')!.volume).toBe(1)
  })

  it('mutes a channel', () => {
    s.audio.getState().setMuted('desktop', true)
    expect(s.audio.getState().channels[0].muted).toBe(true)
  })

  it('enables noise suppression per channel', () => {
    s.audio.getState().setNoiseSuppression('mic', true)

    const channels = s.audio.getState().channels
    expect(channels.find((c) => c.id === 'mic')!.noiseSuppression).toBe(true)
    expect(channels.find((c) => c.id === 'music')!.noiseSuppression).toBe(false)
  })

  it('updates meter levels', () => {
    s.audio.getState().updateLevels('mic', {
      peakL: -12, peakR: -14, rmsL: -18, rmsR: -20,
    })
    expect(s.audio.getState().channels.find((c) => c.id === 'mic')!.levels.peakL).toBe(-12)
  })

  it('ignores an unknown channel rather than throwing', () => {
    expect(() => s.audio.getState().setVolume('nonexistent', 0.5)).not.toThrow()
  })
})

describe('filterStore', () => {
  const SOURCE = 'source-1'

  it('starts with no filters on a source', () => {
    expect(s.filters.getState().filtersBySource[SOURCE]).toBeUndefined()
  })

  it('adds a filter with sensible defaults', () => {
    s.filters.getState().addFilter(SOURCE, 'color-correction')
    const [filter] = s.filters.getState().filtersBySource[SOURCE]

    expect(filter.type).toBe('color-correction')
    expect(filter.enabled).toBe(true)
    expect(filter.name).toBe('Color Correction')
  })

  it('supports every filter type the interface offers', () => {
    for (const type of ['color-correction', 'crop', 'chroma-key', 'blur', 'sharpen'] as const) {
      s.filters.getState().addFilter(SOURCE, type)
    }
    expect(s.filters.getState().filtersBySource[SOURCE]).toHaveLength(5)
  })

  it('selects a newly added filter', () => {
    s.filters.getState().addFilter(SOURCE, 'blur')
    const [filter] = s.filters.getState().filtersBySource[SOURCE]

    expect(s.filters.getState().selectedFilterId).toBe(filter.id)
  })

  it('keeps filters separate per source', () => {
    s.filters.getState().addFilter(SOURCE, 'blur')
    s.filters.getState().addFilter('source-2', 'sharpen')

    expect(s.filters.getState().filtersBySource[SOURCE]).toHaveLength(1)
    expect(s.filters.getState().filtersBySource['source-2']).toHaveLength(1)
  })

  it('updates a filter setting', () => {
    s.filters.getState().addFilter(SOURCE, 'blur')
    const [filter] = s.filters.getState().filtersBySource[SOURCE]

    s.filters.getState().updateFilter(SOURCE, filter.id, { radius: 20 })

    expect(s.filters.getState().filtersBySource[SOURCE][0]).toMatchObject({ radius: 20 })
  })

  it('disables a filter without removing it', () => {
    s.filters.getState().addFilter(SOURCE, 'blur')
    const [filter] = s.filters.getState().filtersBySource[SOURCE]

    s.filters.getState().toggleFilter(SOURCE, filter.id)

    expect(s.filters.getState().filtersBySource[SOURCE][0].enabled).toBe(false)
  })

  it('removes a filter', () => {
    s.filters.getState().addFilter(SOURCE, 'blur')
    const [filter] = s.filters.getState().filtersBySource[SOURCE]

    s.filters.getState().removeFilter(SOURCE, filter.id)

    expect(s.filters.getState().filtersBySource[SOURCE]).toHaveLength(0)
  })

  it('moves the selection when the selected filter is removed', () => {
    s.filters.getState().addFilter(SOURCE, 'blur')
    s.filters.getState().addFilter(SOURCE, 'sharpen')
    const [first, second] = s.filters.getState().filtersBySource[SOURCE]

    s.filters.getState().removeFilter(SOURCE, second.id)

    expect(s.filters.getState().selectedFilterId).toBe(first.id)
  })

  it('persists filters across a reload', async () => {
    s.filters.getState().addFilter(SOURCE, 'chroma-key')

    vi.resetModules()
    const { useFilterStore } = await import('../../src/stores/filterStore')

    expect(useFilterStore.getState().filtersBySource[SOURCE]).toHaveLength(1)
  })
})
