// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'
import type { SourceDto } from '../../src/ipc'

/**
 * The Scenes and Sources panels: where a scene or source is added, selected,
 * and removed.
 */

let bridge: BridgeStub
let ScenesPanel: typeof import('../../src/components/panels/ScenesPanel')['ScenesPanel']
let SourcesPanel: typeof import('../../src/components/panels/SourcesPanel')['SourcesPanel']
let useSceneStore: typeof import('../../src/stores/sceneStore')['useSceneStore']
let useSourceStore: typeof import('../../src/stores/sourceStore')['useSourceStore']
let useCaptureStore: typeof import('../../src/stores/captureStore')['useCaptureStore']

const scene = (id: string, name: string, orderIndex: number) =>
  ({ id, collectionId: 'c1', name, orderIndex, createdAt: 0, updatedAt: 0 })

function dto(id: string, name: string, sceneId = 's1'): SourceDto {
  return {
    id, sceneId, name, sourceType: 'display_capture', settings: '{}', orderIndex: 0,
    visible: true, locked: false, muted: false, volume: 1, transform: '{}',
    createdAt: 0, updatedAt: 0,
  } as SourceDto
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()
  Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })

  ScenesPanel = (await import('../../src/components/panels/ScenesPanel')).ScenesPanel
  SourcesPanel = (await import('../../src/components/panels/SourcesPanel')).SourcesPanel
  useSceneStore = (await import('../../src/stores/sceneStore')).useSceneStore
  useSourceStore = (await import('../../src/stores/sourceStore')).useSourceStore
  useCaptureStore = (await import('../../src/stores/captureStore')).useCaptureStore

  useSceneStore.setState({
    collectionId: 'c1',
    scenes: [scene('s1', 'Scene 1', 0), scene('s3', 'Scene 3', 1)],
    activeSceneId: 's1',
    previewSceneId: null,
  })
})

afterEach(() => {
  cleanup()
  removeBridge()
})

describe('scenes panel', () => {
  it('names a new scene with the first free number', async () => {
    // What the backend returns for the scene it just created.
    bridge.reply('create_scene', scene('s2', 'Scene 2', 2))
    render(<ScenesPanel />)

    await userEvent.click(screen.getAllByRole('button', { name: 'Add scene' })[0])

    const names = useSceneStore.getState().scenes.map((s) => s.name)
    expect(names).toEqual(['Scene 1', 'Scene 3', 'Scene 2'])
  })

  it('selects a scene from the keyboard', async () => {
    render(<ScenesPanel />)
    screen.getByRole('button', { name: 'Scene 3' }).focus()

    await userEvent.keyboard('{Enter}')

    expect(useSceneStore.getState().activeSceneId).toBe('s3')
  })

  it('selects a scene with Space', async () => {
    render(<ScenesPanel />)
    screen.getByRole('button', { name: 'Scene 3' }).focus()

    await userEvent.keyboard(' ')

    expect(useSceneStore.getState().activeSceneId).toBe('s3')
  })

  it('marks the live scene', () => {
    render(<ScenesPanel />)
    expect(screen.getByRole('button', { name: 'Scene 1' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Scene 3' })).not.toHaveAttribute('aria-current')
  })
})

describe('sources panel', () => {
  beforeEach(() => {
    useSourceStore.getState().seedSources('s1', [dto('a', 'Display'), dto('b', 'Webcam')])
  })

  const row = (name: string) => screen.getByRole('group', { name })
  const minus = () => screen.getByRole('button', { name: 'Remove selected' })

  it('cannot remove with nothing selected', () => {
    render(<SourcesPanel />)
    expect(minus()).toBeDisabled()
  })

  // The toolbar's remove button used to delete immediately, with no
  // confirmation and without stopping the source's capture.
  it('asks before the toolbar removes a source', async () => {
    render(<SourcesPanel />)

    await userEvent.click(row('Display'))
    await userEvent.click(minus())

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(useSourceStore.getState().byScene['s1']).toHaveLength(2)
  })

  it('removes after confirming, and stops the capture', async () => {
    const track = { stop: vi.fn(), addEventListener: vi.fn() }
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
    ;(navigator.mediaDevices as unknown as { getDisplayMedia: unknown }).getDisplayMedia =
      vi.fn(async () => stream)
    await act(async () => { await useCaptureStore.getState().startCapture('a', 'display_capture') })

    render(<SourcesPanel />)
    await userEvent.click(row('Display'))
    await userEvent.click(minus())
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }))

    expect(useSourceStore.getState().byScene['s1'].map((s) => s.id)).toEqual(['b'])
    expect(track.stop).toHaveBeenCalled()
    expect(useCaptureStore.getState().activeIds).not.toContain('a')
  })

  it('keeps the source when the confirmation is cancelled', async () => {
    render(<SourcesPanel />)

    await userEvent.click(row('Display'))
    await userEvent.click(minus())
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    expect(useSourceStore.getState().byScene['s1']).toHaveLength(2)
  })

  // The selected id outlived its source, leaving the toolbar enabled with
  // nothing behind it.
  it('drops the selection when the selected source goes away', async () => {
    render(<SourcesPanel />)
    await userEvent.click(row('Display'))
    expect(minus()).toBeEnabled()

    await act(async () => { await useSourceStore.getState().removeSource('s1', 'a') })

    expect(minus()).toBeDisabled()
  })

  it('does not carry a selection over to another scene', async () => {
    useSourceStore.getState().seedSources('s3', [dto('c', 'Other', 's3')])
    render(<SourcesPanel />)
    await userEvent.click(row('Display'))
    expect(minus()).toBeEnabled()

    await act(async () => { useSceneStore.setState({ activeSceneId: 's3' }) })

    expect(minus()).toBeDisabled()
  })

  it('selects a source from the keyboard', async () => {
    render(<SourcesPanel />)

    row('Webcam').focus()
    await userEvent.keyboard('{Enter}')

    expect(row('Webcam')).toHaveAttribute('aria-current', 'true')
    expect(minus()).toBeEnabled()
  })

  // Enter on a button inside the row belongs to that button, not the row.
  it('does not select the row when Enter is pressed on its hide button', async () => {
    render(<SourcesPanel />)
    const hide = within(row('Webcam')).getByRole('button', { name: 'Hide' })

    hide.focus()
    await userEvent.keyboard('{Enter}')

    expect(row('Webcam')).not.toHaveAttribute('aria-current')
  })
})
