// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'
import { remoteMessage } from '../../src/lib/errors'

/**
 * When a command fails the main process says why. Electron hands the page that
 * as an Error with a prefix, and only plain strings used to be recognised, so
 * "Not enough replay data yet" reached the screen as
 * 'IpcError: Command "save_replay" failed'.
 */

const PREFIX = "Error invoking remote method 'cb:invoke': "

describe('remoteMessage', () => {
  it('takes a plain message as it is', () => {
    expect(remoteMessage('disk full', 'x')).toBe('disk full')
  })

  it('takes the reason out of the error Electron builds', () => {
    expect(remoteMessage(new Error(PREFIX + 'Not enough replay data yet'), 'save_replay')).toBe('Not enough replay data yet')
  })

  it('drops the "Error:" Electron adds in front of the reason', () => {
    expect(remoteMessage(new Error(PREFIX + 'Error: Replay buffer is not running'), 'save_replay')).toBe('Replay buffer is not running')
  })

  it('keeps a reason that merely starts like an error name', () => {
    expect(remoteMessage(new Error(PREFIX + 'Errors were found in the file'), 'x')).toBe('Errors were found in the file')
  })

  it('keeps a multi-line reason whole', () => {
    expect(remoteMessage(new Error(PREFIX + 'ffmpeg failed\nline two'), 'x')).toBe('ffmpeg failed\nline two')
  })

  it('names the command when there is no reason', () => {
    expect(remoteMessage(new Error(''), 'save_replay')).toBe('Command "save_replay" failed')
    expect(remoteMessage(new Error(PREFIX), 'save_replay')).toBe('Command "save_replay" failed')
    expect(remoteMessage(undefined, 'save_replay')).toBe('Command "save_replay" failed')
    expect(remoteMessage({ odd: true }, 'save_replay')).toBe('Command "save_replay" failed')
  })
})

describe('what the person sees', () => {
  let bridge: BridgeStub

  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    bridge = installBridge()
  })
  afterEach(() => { cleanup(); removeBridge() })

  it('carries the reason through the ipc layer', async () => {
    const { ipc } = await import('../../src/ipc')
    const api = (window as unknown as { codebuilders: { invoke: ReturnType<typeof vi.fn> } }).codebuilders
    api.invoke.mockRejectedValueOnce(new Error(PREFIX + 'Not enough replay data yet — wait a few more seconds'))

    await expect(ipc.replay.save()).rejects.toThrow('Not enough replay data yet — wait a few more seconds')
  })

  it('shows the reason under Save Replay, without the error class in front of it', async () => {
    const { ControlsPanel } = await import('../../src/components/panels/ControlsPanel')
    const { useOutputStore } = await import('../../src/stores/outputStore')
    useOutputStore.getState().setReplayActive(true)
    const api = (window as unknown as { codebuilders: { invoke: ReturnType<typeof vi.fn> } }).codebuilders
    api.invoke.mockImplementation(async (command: string) => {
      if (command === 'save_replay') throw new Error(PREFIX + 'Not enough replay data yet — wait a few more seconds')
      return undefined
    })
    render(<ControlsPanel />)

    await userEvent.click(screen.getByRole('button', { name: /save replay/i }))

    expect(await screen.findByText('Not enough replay data yet — wait a few more seconds')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('IpcError')
    void bridge
  })
})
