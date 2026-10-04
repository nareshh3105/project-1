// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'
import type { SourceDto } from '../../src/ipc'

/**
 * Source placement. The transform decides where a source sits on the scene
 * canvas, and it used to be dropped on the way in from the database — every
 * source rendered at the default full-frame position no matter what had been
 * stored.
 */

let bridge: BridgeStub
let useSourceStore: typeof import('../../src/stores/sourceStore')['useSourceStore']
let DEFAULT_TRANSFORM: typeof import('../../src/stores/sourceStore')['DEFAULT_TRANSFORM']

const SCENE = 'scene-1'

function dto(over: Partial<SourceDto> = {}): SourceDto {
  return {
    id: 'src-1',
    sceneId: SCENE,
    name: 'Display',
    sourceType: 'display_capture',
    settings: '{}',
    orderIndex: 0,
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    transform: JSON.stringify({ x: 0, y: 0, width: 1920, height: 1080, rotation: 0, scaleX: 1, scaleY: 1 }),
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as SourceDto
}

beforeEach(async () => {
  vi.resetModules()
  bridge = installBridge()
  const mod = await import('../../src/stores/sourceStore')
  useSourceStore = mod.useSourceStore
  DEFAULT_TRANSFORM = mod.DEFAULT_TRANSFORM
})

afterEach(() => removeBridge())

const sources = () => useSourceStore.getState().byScene[SCENE] ?? []
const first = () => sources()[0]

describe('transform parsing', () => {
  it('keeps the stored placement', () => {
    useSourceStore.getState().seedSources(SCENE, [
      dto({ transform: JSON.stringify({ x: 100, y: 50, width: 640, height: 360 }) }),
    ])

    expect(first().transform).toMatchObject({ x: 100, y: 50, width: 640, height: 360 })
  })

  // Regression: fromDto parsed settings and silently discarded transform, so
  // every source rendered full-frame regardless of what was saved.
  it('does not discard the transform', () => {
    useSourceStore.getState().seedSources(SCENE, [
      dto({ transform: JSON.stringify({ x: 42, y: 7 }) }),
    ])

    expect(first().transform.x).toBe(42)
    expect(first().transform.y).toBe(7)
  })

  it('fills in fields a partial transform omits', () => {
    useSourceStore.getState().seedSources(SCENE, [
      dto({ transform: JSON.stringify({ x: 10 }) }),
    ])

    expect(first().transform).toEqual({ ...DEFAULT_TRANSFORM, x: 10 })
  })

  it('falls back to the default when the transform is malformed', () => {
    useSourceStore.getState().seedSources(SCENE, [dto({ transform: 'not json' })])
    expect(first().transform).toEqual(DEFAULT_TRANSFORM)
  })

  it('gives a newly added source a default placement', async () => {
    // The backend answers an add with the stored row. Without a reply the
    // store sees undefined, treats that as a failed save and rolls the source
    // back — which the old empty catch used to hide.
    bridge.reply('add_source', dto({ id: 'new-1', name: 'Webcam', sourceType: 'dshow_video' }))
    await useSourceStore.getState().addSource(SCENE, 'Webcam', 'dshow_video')
    expect(first().transform).toEqual(DEFAULT_TRANSFORM)
  })
})

describe('setTransform', () => {
  beforeEach(() => {
    useSourceStore.getState().seedSources(SCENE, [dto()])
  })

  it('moves a source', () => {
    useSourceStore.getState().setTransform(SCENE, 'src-1', { x: 200, y: 120 })

    expect(first().transform.x).toBe(200)
    expect(first().transform.y).toBe(120)
  })

  it('leaves untouched fields alone', () => {
    useSourceStore.getState().setTransform(SCENE, 'src-1', { x: 200 })

    expect(first().transform.width).toBe(1920)
    expect(first().transform.height).toBe(1080)
  })

  // Dragging fires this on every pointer move; a write per frame would be
  // thousands of database round trips for one gesture.
  it('does not reach the backend on every change', () => {
    useSourceStore.getState().setTransform(SCENE, 'src-1', { x: 1 })
    useSourceStore.getState().setTransform(SCENE, 'src-1', { x: 2 })

    expect(bridge.calls.some((c) => c.command === 'set_source_transform')).toBe(false)
  })

  it('refuses to move a locked source', () => {
    useSourceStore.getState().seedSources(SCENE, [dto({ locked: true })])
    useSourceStore.getState().setTransform(SCENE, 'src-1', { x: 500 })

    expect(first().transform.x).toBe(0)
  })

  it('ignores an unknown source rather than throwing', () => {
    expect(() =>
      useSourceStore.getState().setTransform(SCENE, 'missing', { x: 1 }),
    ).not.toThrow()
  })
})

describe('commitTransform', () => {
  beforeEach(() => {
    useSourceStore.getState().seedSources(SCENE, [dto()])
  })

  it('persists the current placement once', async () => {
    useSourceStore.getState().setTransform(SCENE, 'src-1', { x: 300, y: 150 })
    await useSourceStore.getState().commitTransform(SCENE, 'src-1')

    const args = bridge.argsFor('set_source_transform')
    expect(JSON.parse(args!.transform as string)).toMatchObject({ x: 300, y: 150 })
  })

  it('keeps the local placement when the write fails', async () => {
    bridge.fail('set_source_transform', 'database is locked')

    useSourceStore.getState().setTransform(SCENE, 'src-1', { x: 300 })
    await useSourceStore.getState().commitTransform(SCENE, 'src-1')

    expect(first().transform.x).toBe(300)
  })

  it('does nothing for an unknown source', async () => {
    await useSourceStore.getState().commitTransform(SCENE, 'missing')
    expect(bridge.calls.some((c) => c.command === 'set_source_transform')).toBe(false)
  })
})

describe('addSource return value', () => {
  // The Sources panel used to assume the new source was the last one in the
  // scene. After a failed add that is some other source, so it started a
  // capture on the wrong one.
  it('returns the source that was saved', async () => {
    bridge.reply('add_source', dto({ id: 'new-1', name: 'Webcam', sourceType: 'dshow_video' }))

    const created = await useSourceStore.getState().addSource(SCENE, 'Webcam', 'dshow_video')

    expect(created?.id).toBe('new-1')
    expect(created?.sourceType).toBe('dshow_video')
  })

  it('returns null when it could not be saved, and leaves the others alone', async () => {
    useSourceStore.getState().seedSources(SCENE, [dto({ id: 'existing' })])
    bridge.fail('add_source', 'disk full')

    const created = await useSourceStore.getState().addSource(SCENE, 'Webcam', 'dshow_video')

    expect(created).toBeNull()
    expect(sources().map((s) => s.id)).toEqual(['existing'])
  })
})

describe('setCaptureTarget', () => {
  const TARGET = { kind: 'window' as const, id: 'window:5:0', name: 'Notepad' }

  beforeEach(() => {
    useSourceStore.getState().seedSources(SCENE, [dto({ settings: JSON.stringify({ other: 1 }) })])
  })

  it('records the target on the source', async () => {
    const ok = await useSourceStore.getState().setCaptureTarget(SCENE, 'src-1', TARGET)

    expect(ok).toBe(true)
    expect(first().settings.capture).toEqual(TARGET)
  })

  it('keeps the settings it was not asked to change', async () => {
    await useSourceStore.getState().setCaptureTarget(SCENE, 'src-1', TARGET)
    expect(first().settings.other).toBe(1)
  })

  it('saves it so it survives a restart', async () => {
    await useSourceStore.getState().setCaptureTarget(SCENE, 'src-1', TARGET)

    const args = bridge.argsFor('update_source_settings')
    expect(args?.id).toBe('src-1')
    expect(JSON.parse(args!.settings as string)).toMatchObject({ other: 1, capture: TARGET })
  })

  it('puts the old settings back when saving fails', async () => {
    bridge.fail('update_source_settings', 'database is locked')

    const ok = await useSourceStore.getState().setCaptureTarget(SCENE, 'src-1', TARGET)

    expect(ok).toBe(false)
    expect(first().settings).toEqual({ other: 1 })
  })

  it('reports false for a source that does not exist', async () => {
    expect(await useSourceStore.getState().setCaptureTarget(SCENE, 'missing', TARGET)).toBe(false)
    expect(bridge.argsFor('update_source_settings')).toBeUndefined()
  })
})

describe('updateSettings', () => {
  beforeEach(() => {
    useSourceStore.getState().seedSources(SCENE, [dto({ settings: JSON.stringify({ text: 'old', keep: 1 }) })])
  })

  it('shows the change at once and saves the merged settings', async () => {
    const ok = await useSourceStore.getState().updateSettings(SCENE, 'src-1', { text: 'new' })

    expect(ok).toBe(true)
    expect(first().settings).toEqual({ text: 'new', keep: 1 })
    expect(JSON.parse(bridge.argsFor('update_source_settings')!.settings as string)).toEqual({ text: 'new', keep: 1 })
  })

  it('puts the old settings back, and says so, when saving fails', async () => {
    bridge.fail('update_source_settings', 'disk full')
    const ok = await useSourceStore.getState().updateSettings(SCENE, 'src-1', { text: 'new' })

    expect(ok).toBe(false)
    expect(first().settings).toEqual({ text: 'old', keep: 1 })
  })

  it('does nothing for a source that is not there', async () => {
    expect(await useSourceStore.getState().updateSettings(SCENE, 'missing', { a: 1 })).toBe(false)
    expect(bridge.calls.filter((c) => c.command === 'update_source_settings')).toHaveLength(0)
  })

  it('leaves other sources alone', async () => {
    useSourceStore.getState().seedSources(SCENE, [
      dto({ settings: JSON.stringify({ text: 'a' }) }),
      dto({ id: 'src-2', settings: JSON.stringify({ text: 'b' }) }),
    ])
    await useSourceStore.getState().updateSettings(SCENE, 'src-1', { text: 'changed' })
    expect(sources()[1].settings).toEqual({ text: 'b' })
  })
})
