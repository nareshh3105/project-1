// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge } from '../mocks/bridge'

/**
 * This modal is the only thing telling a user why recording does not work, so
 * it has to appear exactly when FFmpeg is missing — and dismissing it must not
 * leave the application unusable.
 */

let FfmpegMissingModal: typeof import('../../src/components/modals/FfmpegMissingModal')['FfmpegMissingModal']
let useOutputStore: typeof import('../../src/stores/outputStore')['useOutputStore']

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
  installBridge()

  FfmpegMissingModal = (await import('../../src/components/modals/FfmpegMissingModal')).FfmpegMissingModal
  useOutputStore = (await import('../../src/stores/outputStore')).useOutputStore
})

afterEach(() => {
  cleanup()
  removeBridge()
})

/** Keeps state settled by an awaited handler inside an act scope. */
async function click(el: HTMLElement) {
  await act(async () => {
    await userEvent.click(el)
  })
}

describe('when to appear', () => {
  it('stays hidden while the check has not run', () => {
    // null means "not yet known", which must not look like a confirmed absence.
    render(<FfmpegMissingModal />)
    expect(screen.queryByText(/ffmpeg not found/i)).toBeNull()
  })

  it('stays hidden when FFmpeg is present', () => {
    useOutputStore.getState().setFfmpegAvailable(true)
    render(<FfmpegMissingModal />)

    expect(screen.queryByText(/ffmpeg not found/i)).toBeNull()
  })

  it('appears when FFmpeg is missing', () => {
    useOutputStore.getState().setFfmpegAvailable(false)
    render(<FfmpegMissingModal />)

    expect(screen.getByText(/ffmpeg not found/i)).toBeTruthy()
  })
})

describe('content', () => {
  beforeEach(() => {
    useOutputStore.getState().setFfmpegAvailable(false)
    render(<FfmpegMissingModal />)
  })

  it('gives a command that installs it', () => {
    expect(screen.getByText(/winget install --id Gyan\.FFmpeg -e/)).toBeTruthy()
  })

  it('offers an alternative for users without winget', () => {
    expect(screen.getByText(/choco install ffmpeg/)).toBeTruthy()
  })

  it('links somewhere to download it manually', () => {
    const link = screen.getByRole('link', { name: /ffmpeg\.org/i })
    expect(link.getAttribute('href')).toBe('https://ffmpeg.org/download.html')
  })

  it('says a restart is needed afterwards', () => {
    expect(screen.getByText(/restart codebuilders/i)).toBeTruthy()
  })

  it('names what stops working without it', () => {
    expect(screen.getByText(/recording, streaming, replay buffer/i)).toBeTruthy()
  })
})

describe('dismissal', () => {
  beforeEach(() => {
    useOutputStore.getState().setFfmpegAvailable(false)
  })

  it('closes when dismissed', async () => {
    render(<FfmpegMissingModal />)
    await click(screen.getByRole('button', { name: /dismiss/i }))

    await waitFor(() => {
      expect(screen.queryByText(/ffmpeg not found/i)).toBeNull()
    })
  })

  /**
   * Radix marks the rest of the page aria-hidden while the dialog is open, and
   * must clear it on close. The component used to unmount itself while still
   * open, which stranded that attribute on the app root in a real browser and
   * hid the whole interface from assistive technology.
   *
   * Caveat: jsdom does not reproduce that failure — React still runs effect
   * cleanups when a component returns null, so this passes against the old
   * code too. It verifies the attribute is cleared, not that the regression
   * cannot return. Catching that needs a browser.
   */
  it('clears aria-hidden from the page after closing', async () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)

    render(<FfmpegMissingModal />, { container: root })
    await click(screen.getByRole('button', { name: /dismiss/i }))

    await waitFor(() => {
      expect(screen.queryByText(/ffmpeg not found/i)).toBeNull()
    })

    for (const el of Array.from(document.body.children)) {
      expect(el.getAttribute('aria-hidden')).not.toBe('true')
    }
  })

  it('stays dismissed for the rest of the session', async () => {
    const { unmount } = render(<FfmpegMissingModal />)
    await click(screen.getByRole('button', { name: /dismiss/i }))
    await waitFor(() => expect(screen.queryByText(/ffmpeg not found/i)).toBeNull())

    // Remounting, as a re-render of the shell would.
    unmount()
    render(<FfmpegMissingModal />)

    expect(screen.queryByText(/ffmpeg not found/i)).toBeNull()
  })
})
