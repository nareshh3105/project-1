// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'

/**
 * The controls panel is where FFmpeg's absence has to be visible. Every output
 * button depends on it, and a user with no FFmpeg should be told why rather
 * than clicking something that silently fails.
 */

let bridge: BridgeStub
let ControlsPanel: typeof import('../../src/components/panels/ControlsPanel')['ControlsPanel']
let useOutputStore: typeof import('../../src/stores/outputStore')['useOutputStore']

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()

  ControlsPanel = (await import('../../src/components/panels/ControlsPanel')).ControlsPanel
  useOutputStore = (await import('../../src/stores/outputStore')).useOutputStore
})

afterEach(() => {
  cleanup()
  removeBridge()
})

/** Sets whether the backend reported FFmpeg as present. */
function setFfmpeg(available: boolean | null) {
  if (available !== null) useOutputStore.getState().setFfmpegAvailable(available)
}

const button = (name: RegExp) => screen.getByRole('button', { name })

/**
 * The click handlers set state after an awaited IPC call, which lands
 * outside the act scope userEvent establishes. Wrapping the whole
 * interaction keeps the resulting update inside one.
 */
async function click(el: HTMLElement) {
  await act(async () => {
    await userEvent.click(el)
  })
}

describe('with FFmpeg available', () => {
  beforeEach(() => {
    setFfmpeg(true)
    render(<ControlsPanel />)
  })

  it('offers every output control', () => {
    expect(button(/start streaming/i)).toBeTruthy()
    expect(button(/start recording/i)).toBeTruthy()
    expect(button(/start replay buffer/i)).toBeTruthy()
    expect(button(/start virtual camera/i)).toBeTruthy()
  })

  it('enables them', () => {
    expect(button(/start recording/i)).not.toBeDisabled()
    expect(button(/start virtual camera/i)).not.toBeDisabled()
  })

  it('shows no warning', () => {
    expect(screen.queryByText(/ffmpeg not found/i)).toBeNull()
  })

  it('starts a recording when clicked', async () => {
    await click(button(/start recording/i))

    await waitFor(() => {
      expect(bridge.calls.some((c) => c.command === 'start_recording')).toBe(true)
    })
  })

  it('starts the replay buffer with a buffer length', async () => {
    await click(button(/start replay buffer/i))

    await waitFor(() => {
      expect(bridge.argsFor('start_replay_buffer')).toMatchObject({ bufferSecs: 30 })
    })
  })

  it('opens stream settings rather than streaming blind', async () => {
    await click(button(/start streaming/i))
    await waitFor(() => expect(button(/start streaming/i)).toBeEnabled())

    // Streaming needs a URL and key, so the button opens the modal instead of
    // invoking the backend directly.
    expect(bridge.calls.some((c) => c.command === 'start_streaming')).toBe(false)
  })
})

describe('with FFmpeg missing', () => {
  beforeEach(() => {
    setFfmpeg(false)
    render(<ControlsPanel />)
  })

  it('explains why the controls are unavailable', () => {
    expect(screen.getByText(/ffmpeg not found/i)).toBeTruthy()
  })

  it('disables every output that needs it', () => {
    expect(button(/start streaming/i)).toBeDisabled()
    expect(button(/start recording/i)).toBeDisabled()
    expect(button(/start replay buffer/i)).toBeDisabled()
    expect(button(/start virtual camera/i)).toBeDisabled()
  })

  it('says why on hover rather than only grеying out', () => {
    expect(button(/start recording/i).getAttribute('title')).toMatch(/ffmpeg not found/i)
  })

  it('leaves screenshot and settings usable', () => {
    // Neither needs ffmpeg, so removing them would be over-correcting.
    expect(button(/screenshot/i)).not.toBeDisabled()
    expect(button(/settings/i)).not.toBeDisabled()
  })

  it('does not invoke the backend when a disabled control is clicked', async () => {
    await click(button(/start recording/i))
    await waitFor(() => expect(button(/start recording/i)).toBeDisabled())

    expect(bridge.calls.some((c) => c.command === 'start_recording')).toBe(false)
  })
})

describe('while an output is running', () => {
  it('offers to stop a recording in progress', () => {
    setFfmpeg(true)
    useOutputStore.getState().setRecordingStatus(true, 'C:/Videos/a.mkv')
    render(<ControlsPanel />)

    expect(button(/stop recording/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /start recording/i })).toBeNull()
  })

  it('keeps stop reachable even if FFmpeg went missing mid-session', () => {
    // Otherwise a running recording could never be stopped from the interface.
    setFfmpeg(false)
    useOutputStore.getState().setRecordingStatus(true, 'a.mkv')
    render(<ControlsPanel />)

    expect(button(/stop recording/i)).not.toBeDisabled()
  })

  it('offers to save while the replay buffer runs', () => {
    setFfmpeg(true)
    useOutputStore.getState().setReplayActive(true)
    render(<ControlsPanel />)

    expect(button(/save replay/i)).toBeTruthy()
  })

  it('hides save when the buffer is not running', () => {
    setFfmpeg(true)
    render(<ControlsPanel />)

    expect(screen.queryByRole('button', { name: /save replay/i })).toBeNull()
  })

  it('shows where the virtual camera can be consumed', () => {
    setFfmpeg(true)
    useOutputStore.getState().setVirtualCameraStatus(true, 'udp://127.0.0.1:12345')
    render(<ControlsPanel />)

    expect(screen.getByText(/udp:\/\/127\.0\.0\.1:12345/)).toBeTruthy()
  })
})

describe('failures', () => {
  beforeEach(() => setFfmpeg(true))

  it('surfaces a recording failure instead of failing silently', async () => {
    bridge.fail('start_recording', 'Could not open output file')
    render(<ControlsPanel />)

    await click(button(/start recording/i))

    await waitFor(() => {
      expect(screen.getByText(/could not open output file/i)).toBeTruthy()
    })
  })

  it('surfaces a replay failure', async () => {
    bridge.fail('start_replay_buffer', 'ffmpeg exited immediately')
    render(<ControlsPanel />)

    await click(button(/start replay buffer/i))

    await waitFor(() => {
      expect(screen.getByText(/exited immediately/i)).toBeTruthy()
    })
  })

  it('confirms where a screenshot was saved', async () => {
    bridge.reply('take_screenshot', 'C:/Users/x/Pictures/Screenshot_2026.png')
    render(<ControlsPanel />)

    await click(button(/screenshot/i))

    await waitFor(() => {
      expect(screen.getByText(/Screenshot_2026\.png/)).toBeTruthy()
    })
  })

  it('reports a screenshot failure', async () => {
    bridge.fail('take_screenshot', 'No screen available to capture')
    render(<ControlsPanel />)

    await click(button(/screenshot/i))

    await waitFor(() => {
      expect(screen.getByText(/no screen available/i)).toBeTruthy()
    })
  })
})
