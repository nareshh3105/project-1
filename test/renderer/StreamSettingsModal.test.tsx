// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge } from '../mocks/bridge'

/**
 * The stream key field. Revealing the key looked broken: the placeholder was a
 * row of bullet characters, so an empty field was indistinguishable from a
 * masked one and the toggle appeared to do nothing.
 */

let StreamSettingsModal: typeof import('../../src/components/modals/StreamSettingsModal')['StreamSettingsModal']
let useUIStore: typeof import('../../src/stores/uiStore')['useUIStore']

const STORAGE_KEY = 'cb:stream'

async function mount() {
  render(<StreamSettingsModal />)
  // Radix mounts the portal across a tick; await the flush so the
  // dialog's own effects settle inside act.
  await act(async () => { useUIStore.getState().openModal('stream-settings') })
  return await screen.findByLabelText(/show stream key/i)
}

// Queried by label, so a placeholder change fails only the placeholder test.
const keyInput = () => screen.getByLabelText('Stream Key')

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  installBridge()
  StreamSettingsModal = (await import('../../src/components/modals/StreamSettingsModal')).StreamSettingsModal
  useUIStore = (await import('../../src/stores/uiStore')).useUIStore
})

afterEach(() => {
  cleanup()
  removeBridge()
})

describe('stream key visibility', () => {
  it('masks the key until it is revealed', async () => {
    const toggle = await mount()
    await userEvent.type(keyInput(), 'live_123456')

    expect(keyInput()).toHaveAttribute('type', 'password')

    await userEvent.click(toggle)
    expect(keyInput()).toHaveAttribute('type', 'text')

    await userEvent.click(toggle)
    expect(keyInput()).toHaveAttribute('type', 'password')
  })

  it('actually shows the characters once revealed', async () => {
    const toggle = await mount()
    await userEvent.type(keyInput(), 'live_123456')
    await userEvent.click(toggle)

    // A `text` input whose value is readable is the whole point of the toggle.
    expect(keyInput()).toHaveValue('live_123456')
    expect(keyInput()).toHaveAttribute('type', 'text')
  })

  // The regression: bullets as placeholder text meant revealing an empty field
  // still displayed dots, which reads as "the toggle is broken".
  it('does not disguise an empty field as a masked value', async () => {
    await mount()
    const placeholder = keyInput().getAttribute('placeholder') ?? ''

    expect(keyInput()).toHaveValue('')
    expect(placeholder).not.toMatch(/[•●*]/)
  })

  it('labels the toggle for screen readers and reflects its state', async () => {
    const toggle = await mount()
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(toggle)
    expect(await screen.findByLabelText(/hide stream key/i)).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('persisted settings', () => {
  it('restores a saved key', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rtmpUrl: 'rtmp://a/b', streamKey: 'saved_key' }))
    vi.resetModules()
    StreamSettingsModal = (await import('../../src/components/modals/StreamSettingsModal')).StreamSettingsModal
    useUIStore = (await import('../../src/stores/uiStore')).useUIStore

    await mount()
    expect(keyInput()).toHaveValue('saved_key')
  })

  // A half-written entry used to yield `undefined`, and `streamKey.trim()`
  // threw on Go Live. Asserting the input reads '' proves nothing — an
  // uncontrolled input reads '' either way — so drive the button instead.
  it('can still go live when the stored entry is missing the key', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rtmpUrl: 'rtmp://a/b' }))
    vi.resetModules()
    const b = installBridge()
    StreamSettingsModal = (await import('../../src/components/modals/StreamSettingsModal')).StreamSettingsModal
    useUIStore = (await import('../../src/stores/uiStore')).useUIStore

    await mount()
    await userEvent.click(screen.getByRole('button', { name: /go live/i }))

    expect(b.argsFor('start_streaming')).toMatchObject({ rtmpUrl: 'rtmp://a/b', streamKey: '' })
    expect(screen.queryByText(/is not a function|undefined/i)).toBeNull()
  })
})
