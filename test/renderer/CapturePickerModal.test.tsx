// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'
import type { SourceDto } from '../../src/ipc'

/**
 * The picker is how a capture source learns what to capture, so it has to list
 * what is really there, remember the choice, and then start capturing it.
 */

let bridge: BridgeStub
let CapturePickerModal: typeof import('../../src/components/modals/CapturePickerModal')['CapturePickerModal']
let useUIStore: typeof import('../../src/stores/uiStore')['useUIStore']
let useSourceStore: typeof import('../../src/stores/sourceStore')['useSourceStore']
let useCaptureStore: typeof import('../../src/stores/captureStore')['useCaptureStore']

const SCENE = 'scene-1'

function dto(over: Partial<SourceDto> = {}): SourceDto {
  return {
    id: 'src-1', sceneId: SCENE, name: 'Display', sourceType: 'display_capture', settings: '{}',
    orderIndex: 0, visible: true, locked: false, muted: false, volume: 1, transform: '{}',
    createdAt: 0, updatedAt: 0, ...over,
  } as SourceDto
}

const item = (id: string, name: string, kind: 'screen' | 'window', thumbnail: string | null = null) =>
  ({ id, name, kind, thumbnail, icon: null })

const stream = () => {
  const track = { stop: vi.fn(), addEventListener: vi.fn() }
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
}

async function open(sourceType: SourceDto['sourceType'] = 'display_capture', settings = '{}') {
  useSourceStore.getState().seedSources(SCENE, [dto({ sourceType, settings })])
  render(<CapturePickerModal />)
  await act(async () => {
    useUIStore.getState().openModal('capture-picker', { sceneId: SCENE, sourceId: 'src-1', sourceType })
  })
  return await screen.findByRole('dialog')
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()

  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getDisplayMedia: vi.fn(async () => stream()),
      getUserMedia: vi.fn(async () => stream()),
      enumerateDevices: vi.fn(async () => [
        { kind: 'videoinput', deviceId: 'cam-1', label: 'Front camera' },
        { kind: 'videoinput', deviceId: 'cam-2', label: 'Capture card' },
        { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
      ]),
    },
    configurable: true,
  })

  bridge.reply('list_capture_sources', [
    item('screen:0:0', 'Entire screen', 'screen', 'data:image/png;base64,AAAA'),
    item('screen:1:0', 'Screen 2', 'screen'),
  ])

  CapturePickerModal = (await import('../../src/components/modals/CapturePickerModal')).CapturePickerModal
  useUIStore = (await import('../../src/stores/uiStore')).useUIStore
  useSourceStore = (await import('../../src/stores/sourceStore')).useSourceStore
  useCaptureStore = (await import('../../src/stores/captureStore')).useCaptureStore
})

afterEach(() => {
  cleanup()
  removeBridge()
})

const choices = () => screen.getAllByRole('radio')
const selectButton = () => screen.getByRole('button', { name: 'Select' })

describe('what it offers', () => {
  it('lists the screens that can be captured', async () => {
    await open()

    expect(choices().map((c) => c.textContent)).toEqual(['Entire screen', 'Screen 2'])
  })

  it('asks only for the kind of source the type captures', async () => {
    await open('window_capture')
    const asked = bridge.calls.filter((c) => c.command === 'list_capture_sources')
    expect(asked[0].args.kinds).toEqual(['window'])
  })

  it('shows a thumbnail where the system provided one', async () => {
    await open()
    const withPicture = choices()[0].querySelector('img')
    expect(withPicture).toHaveAttribute('src', 'data:image/png;base64,AAAA')
  })

  it('names cameras instead of showing pictures', async () => {
    await open('dshow_video')
    expect(choices().map((c) => c.textContent)).toEqual(['Front camera', 'Capture card'])
  })

  it('says so when there is nothing to capture', async () => {
    bridge.reply('list_capture_sources', [])
    await open('window_capture')
    expect(await screen.findByText(/no windows are open/i)).toBeInTheDocument()
  })

  it('shows why listing failed', async () => {
    bridge.fail('list_capture_sources', 'desktop capturer unavailable')
    await open()
    expect(await screen.findByRole('alert')).toHaveTextContent('desktop capturer unavailable')
  })

  it('can be refreshed to pick up a window opened since', async () => {
    await open('window_capture')
    bridge.reply('list_capture_sources', [item('window:7:0', 'Just opened', 'window')])

    await userEvent.click(screen.getByRole('button', { name: 'Refresh the list' }))

    expect(await screen.findByRole('radio', { name: /just opened/i })).toBeInTheDocument()
  })
})

describe('choosing', () => {
  it('cannot confirm before anything is chosen', async () => {
    await open()
    expect(selectButton()).toBeDisabled()
  })

  it('starts from what the source already points at', async () => {
    const saved = JSON.stringify({ capture: { kind: 'screen', id: 'screen:1:0', name: 'Screen 2' } })
    await open('display_capture', saved)

    expect(screen.getByRole('radio', { name: /screen 2/i })).toHaveAttribute('aria-checked', 'true')
    expect(selectButton()).toBeEnabled()
  })

  it('marks the chosen one for assistive technology', async () => {
    await open()
    await userEvent.click(choices()[1])

    expect(choices()[1]).toHaveAttribute('aria-checked', 'true')
    expect(choices()[0]).toHaveAttribute('aria-checked', 'false')
  })

  it('remembers the choice on the source', async () => {
    await open()
    await userEvent.click(choices()[1])
    await userEvent.click(selectButton())

    await vi.waitFor(() => expect(bridge.argsFor('update_source_settings')).toBeDefined())
    const saved = JSON.parse(bridge.argsFor('update_source_settings')!.settings as string)
    expect(saved.capture).toEqual({ kind: 'screen', id: 'screen:1:0', name: 'Screen 2' })
  })

  it('starts capturing what was chosen', async () => {
    await open()
    await userEvent.click(choices()[1])
    await userEvent.click(selectButton())

    await vi.waitFor(() => expect(useCaptureStore.getState().activeIds).toContain('src-1'))
    expect(bridge.calls.some((c) => c.command === 'prepare_capture' && c.args.sourceId === 'screen:1:0')).toBe(true)
  })

  it('closes the dialog', async () => {
    await open()
    await userEvent.click(choices()[0])
    await userEvent.click(selectButton())

    expect(useUIStore.getState().modal).toBeNull()
  })

  it('chooses and confirms in one step on double-click', async () => {
    await open()
    await userEvent.dblClick(choices()[1])

    await vi.waitFor(() => expect(useCaptureStore.getState().activeIds).toContain('src-1'))
    expect(useUIStore.getState().modal).toBeNull()
  })

  it('does not capture when the choice could not be saved', async () => {
    bridge.fail('update_source_settings', 'database is locked')
    await open()
    await userEvent.click(choices()[0])
    await userEvent.click(selectButton())

    await vi.waitFor(() => expect(useUIStore.getState().modal).toBeNull())
    expect(useCaptureStore.getState().activeIds).not.toContain('src-1')
  })

  it('records a camera by its device id', async () => {
    await open('dshow_video')
    await userEvent.click(choices()[1])
    await userEvent.click(selectButton())

    await vi.waitFor(() => expect(bridge.argsFor('update_source_settings')).toBeDefined())
    const saved = JSON.parse(bridge.argsFor('update_source_settings')!.settings as string)
    expect(saved.capture).toEqual({ kind: 'camera', id: 'cam-2', name: 'Capture card' })
  })
})

describe('cancelling', () => {
  it('changes nothing', async () => {
    await open()
    await userEvent.click(choices()[0])

    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    expect(bridge.argsFor('update_source_settings')).toBeUndefined()
    expect(useCaptureStore.getState().activeIds).toEqual([])
    expect(useUIStore.getState().modal).toBeNull()
  })
})
