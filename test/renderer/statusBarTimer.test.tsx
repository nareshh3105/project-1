// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

/**
 * The elapsed time of a recording or stream is counted in seconds by the output
 * store, and the clock formats milliseconds. The two were joined without
 * converting, so the status bar read 00:00 for the first sixteen minutes.
 */

let StatusBar: typeof import('../../src/components/layout/StatusBar')['StatusBar']
let useOutputStore: typeof import('../../src/stores/outputStore')['useOutputStore']

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
  StatusBar = (await import('../../src/components/layout/StatusBar')).StatusBar
  useOutputStore = (await import('../../src/stores/outputStore')).useOutputStore
})

afterEach(() => { cleanup(); vi.useRealTimers() })

const text = () => document.querySelector('footer')!.textContent ?? ''
const show = (fn: () => void) => { render(<StatusBar />); act(fn) }

describe('the recording clock', () => {
  it('reads the time elapsed, not zero', () => {
    show(() => {
      useOutputStore.getState().setRecordingStatus(true, 'a.mkv')
      vi.setSystemTime(new Date('2026-01-01T10:01:05Z'))
      useOutputStore.getState().tickElapsed()
    })
    expect(text()).toContain('REC01:05')
    expect(text()).toContain('Duration:01:05')
  })

  it('starts at zero and counts up as it is ticked', () => {
    show(() => useOutputStore.getState().setRecordingStatus(true, 'a.mkv'))
    expect(text()).toContain('REC00:00')

    act(() => { vi.setSystemTime(new Date('2026-01-01T10:00:03Z')); useOutputStore.getState().tickElapsed() })
    expect(text()).toContain('REC00:03')
  })

  it('goes into hours', () => {
    show(() => {
      useOutputStore.getState().setRecordingStatus(true, 'a.mkv')
      vi.setSystemTime(new Date('2026-01-01T11:02:05Z'))
      useOutputStore.getState().tickElapsed()
    })
    expect(text()).toContain('REC1:02:05')
  })

  it('says Stopped, and a zero duration, when nothing runs', () => {
    show(() => {})
    expect(text()).toContain('RECStopped')
    expect(text()).toContain('Duration:00:00')
  })
})

describe('the stream clock', () => {
  it('reads the time elapsed', () => {
    show(() => {
      useOutputStore.getState().setStreamingStatus(true)
      vi.setSystemTime(new Date('2026-01-01T10:12:34Z'))
      useOutputStore.getState().tickElapsed()
    })
    expect(text()).toContain('STREAM12:34')
    expect(text()).toContain('Duration:12:34')
  })

  it('shows the recording as the duration when both run', () => {
    show(() => {
      useOutputStore.getState().setStreamingStatus(true)
      vi.setSystemTime(new Date('2026-01-01T10:00:10Z'))
      useOutputStore.getState().setRecordingStatus(true, 'a.mkv')
      vi.setSystemTime(new Date('2026-01-01T10:00:15Z'))
      useOutputStore.getState().tickElapsed()
    })
    expect(text()).toContain('STREAM00:15')
    expect(text()).toContain('REC00:05')
    expect(text()).toContain('Duration:00:05')
  })
})
