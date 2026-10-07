// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'

/**
 * Scenes are named the way OBS names them: the counter only goes up, and two
 * scenes in a collection never share a name.
 */

let bridge: BridgeStub
let store: typeof import('../../src/stores/sceneStore')
let useNotifyStore: typeof import('../../src/stores/notifyStore')['useNotifyStore']

const scene = (id: string, name: string, orderIndex: number) =>
  ({ id, collectionId: 'c1', name, orderIndex, createdAt: 0, updatedAt: 0 })
const names = () => store.useSceneStore.getState().scenes.map((s) => s.name)
const messages = () => useNotifyStore.getState().notices.map((n) => n.message)

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()
  Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })
  store = await import('../../src/stores/sceneStore')
  useNotifyStore = (await import('../../src/stores/notifyStore')).useNotifyStore
  store.useSceneStore.setState({
    collectionId: 'c1',
    scenes: [scene('s1', 'Scene 1', 0), scene('s2', 'Scene 2', 1), scene('s3', 'Scene 3', 2)],
    activeSceneId: 's1', previewSceneId: null,
  })
})

afterEach(() => { cleanup(); removeBridge() })

describe('numbering new scenes', () => {
  it('goes on to Scene 4 after Scene 2 is deleted', () => {
    store.useSceneStore.setState({ scenes: [scene('s1', 'Scene 1', 0), scene('s3', 'Scene 3', 1)] })
    expect(store.claimSceneName('c1', names())).toBe('Scene 4')
  })

  it('does not hand a number out twice, even if the scene made with it is deleted', () => {
    expect(store.claimSceneName('c1', names())).toBe('Scene 4')
    // Scene 4 was never added, or was added and removed: the number stays used.
    expect(store.claimSceneName('c1', names())).toBe('Scene 5')
  })

  it('does not reuse the number of the newest scene after it is deleted', () => {
    expect(store.claimSceneName('c1', names())).toBe('Scene 4')
    store.useSceneStore.setState({ scenes: store.useSceneStore.getState().scenes.slice(0, 2) })
    expect(store.claimSceneName('c1', names())).toBe('Scene 5')
  })

  it('counts each collection on its own', () => {
    expect(store.claimSceneName('c1', names())).toBe('Scene 4')
    expect(store.claimSceneName('c2', [])).toBe('Scene 1')
  })

  it('is not thrown by a renamed scene that still has a number in it', () => {
    expect(store.nextSceneName(['Scene 9', 'Intro'])).toBe('Scene 10')
    expect(store.nextSceneName(['Scene 1 (copy)'])).toBe('Scene 1')
  })
})

describe('unique names in the store', () => {
  it('refuses a rename to a name another scene has, and says so', async () => {
    await store.useSceneStore.getState().renameScene('s2', 'Scene 3')

    expect(names()).toEqual(['Scene 1', 'Scene 2', 'Scene 3'])
    expect(bridge.calls.some((c) => c.command === 'rename_scene')).toBe(false)
    expect(messages()).toEqual(['A scene named "Scene 3" already exists in this collection.'])
  })

  it.each(['scene 3', '  SCENE 3  '])('sees %j as the same name', async (name) => {
    await store.useSceneStore.getState().renameScene('s2', name)
    expect(names()).toEqual(['Scene 1', 'Scene 2', 'Scene 3'])
    expect(bridge.calls.some((c) => c.command === 'rename_scene')).toBe(false)
  })

  it('allows a rename to a free name, trimmed', async () => {
    await store.useSceneStore.getState().renameScene('s2', '  Intro ')
    expect(names()).toEqual(['Scene 1', 'Intro', 'Scene 3'])
    expect(bridge.argsFor('rename_scene')).toMatchObject({ id: 's2', name: 'Intro' })
  })

  it('allows a scene to change only the case of its own name', async () => {
    await store.useSceneStore.getState().renameScene('s2', 'scene 2')
    expect(names()[1]).toBe('scene 2')
  })

  it('ignores an empty name', async () => {
    await store.useSceneStore.getState().renameScene('s2', '   ')
    expect(names()[1]).toBe('Scene 2')
    expect(bridge.calls).toEqual([])
  })

  it('does not create a scene with a name that is taken', async () => {
    bridge.reply('create_scene', scene('n', 'Scene 1 2', 3))
    await store.useSceneStore.getState().createScene('Scene 1')
    expect(bridge.argsFor('create_scene')).toMatchObject({ name: 'Scene 1 2' })
  })

  it('names a second copy differently from the first', async () => {
    bridge.reply('duplicate_scene', { scene: scene('n', 'Scene 1 (copy) 2', 4), sources: [] })
    store.useSceneStore.setState({ scenes: [...store.useSceneStore.getState().scenes, scene('c', 'Scene 1 (copy)', 3)] })

    await store.useSceneStore.getState().duplicateScene('s1')

    expect(names()).toContain('Scene 1 (copy) 2')
    expect(new Set(names().map((n) => n.toLowerCase())).size).toBe(names().length)
  })
})

describe('isSceneNameTaken and uniqueSceneName', () => {
  const list = [{ id: 'a', name: 'Intro' }, { id: 'b', name: 'Main' }]

  it('ignores the scene being renamed', () => {
    expect(store.isSceneNameTaken(list, 'Intro', 'a')).toBe(false)
    expect(store.isSceneNameTaken(list, 'Intro', 'b')).toBe(true)
    expect(store.isSceneNameTaken(list, 'Outro')).toBe(false)
  })

  it('finds the first free number', () => {
    expect(store.uniqueSceneName(['A', 'A 2', 'A 3'], 'A')).toBe('A 4')
    expect(store.uniqueSceneName(['A', 'A 3'], 'a')).toBe('a 2')
    expect(store.uniqueSceneName(['B'], 'A')).toBe('A')
  })
})

describe('the rename dialog', () => {
  async function open() {
    const { RenameModal } = await import('../../src/components/modals/RenameModal')
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    const validate = (n: string) =>
      store.isSceneNameTaken(store.useSceneStore.getState().scenes, n, 's2') ? 'A scene named "' + n + '" already exists.' : null
    render(<RenameModal open title="Rename Scene" current="Scene 2" onConfirm={onConfirm} onClose={onClose} validate={validate} />)
    return {
      onConfirm, onClose,
      input: screen.getByRole('textbox') as HTMLInputElement,
      button: screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement,
    }
  }

  it('says why a taken name cannot be used and keeps the dialog open', async () => {
    const { onConfirm, onClose, input, button } = await open()
    fireEvent.change(input, { target: { value: 'Scene 3' } })

    expect(screen.getByRole('alert').textContent).toBe('A scene named "Scene 3" already exists.')
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('accepts a free name', async () => {
    const { onConfirm, input, button } = await open()
    fireEvent.change(input, { target: { value: 'Intro' } })

    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(button)
    expect(onConfirm).toHaveBeenCalledWith('Intro')
  })

  it('shows no warning for the name it opened with', async () => {
    await open()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
