// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installBridge, removeBridge } from '../mocks/bridge'

/**
 * Corrupt persisted state must not stop the app booting.
 *
 * Every store reads its slice from localStorage inside a try/catch, which
 * looks safe but is not: `JSON.parse('null')` returns null without throwing,
 * and `JSON.parse('{"a":1}')` returns an object where an array was expected.
 * The bad value escapes the catch and takes the app down later, when a
 * component maps over it — a blank window with no way to recover short of
 * clearing site data.
 */

const cases: Array<[string, string]> = [
  ['null',            'null'],
  ['a bare string',   '"nonsense"'],
  ['a number',        '42'],
  ['an object',       '{"unexpected":true}'],
  ['an array',        '[1,2,3]'],
  ['truncated JSON',  '{"type":'],
]

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  installBridge()
})

afterEach(() => removeBridge())

describe('hotkeys survive corrupt storage', () => {
  it.each(cases)('recovers from %s', async (_label, raw) => {
    localStorage.setItem('cb:hotkeys', raw)
    const { useHotkeyStore } = await import('../../src/stores/hotkeyStore')

    const { hotkeys } = useHotkeyStore.getState()
    expect(Array.isArray(hotkeys)).toBe(true)
    // Components map over this; a non-Hotkey entry crashes the render.
    expect(hotkeys.every((h) => h && typeof h.action === 'string')).toBe(true)
  })
})

describe('filters survive corrupt storage', () => {
  it.each(cases)('recovers from %s', async (_label, raw) => {
    localStorage.setItem('cb:filters', raw)
    const { useFilterStore } = await import('../../src/stores/filterStore')

    const { filtersBySource } = useFilterStore.getState()
    expect(filtersBySource).toBeTypeOf('object')
    expect(filtersBySource).not.toBeNull()
    // Looking up an unknown source must give a list, never undefined-shaped junk.
    for (const list of Object.values(filtersBySource)) {
      expect(Array.isArray(list)).toBe(true)
    }
  })
})

describe('transition settings survive corrupt storage', () => {
  it.each(cases)('recovers from %s', async (_label, raw) => {
    localStorage.setItem('cb:transition', raw)
    const { useTransitionStore } = await import('../../src/stores/transitionStore')

    const { type, durationMs } = useTransitionStore.getState()
    // An undefined duration reaches CSS as `animation-duration: undefinedms`,
    // which the browser drops — the transition silently never runs.
    expect(typeof type).toBe('string')
    expect(Number.isFinite(durationMs)).toBe(true)
    expect(durationMs).toBeGreaterThan(0)
  })
})

describe('settings survive corrupt storage', () => {
  it.each(cases)('recovers from %s', async (_label, raw) => {
    localStorage.setItem('cb:settings', raw)
    const { useSettingsStore } = await import('../../src/stores/settingsStore')

    const s = useSettingsStore.getState()
    expect(s.video?.baseResolution?.width).toBeGreaterThan(0)
    expect(s.video?.baseResolution?.height).toBeGreaterThan(0)
  })
})

/**
 * The other half of the contract. A guard that is too strict is worse than no
 * guard: it rejects genuine saved state and silently resets the user's
 * configuration on upgrade, with no error to explain where it went. Each of
 * these saves through the store's own writer and reloads.
 */
describe('genuine saved state survives a reload', () => {
  it('keeps customised hotkeys', async () => {
    const { useHotkeyStore } = await import('../../src/stores/hotkeyStore')
    const original = useHotkeyStore.getState().hotkeys
    expect(original.length).toBeGreaterThan(0)

    useHotkeyStore.getState().setBinding(original[0].id, { key: 'F9', modifiers: ['ctrl'] })
    const expected = useHotkeyStore.getState().hotkeys

    vi.resetModules()
    const reloaded = (await import('../../src/stores/hotkeyStore')).useHotkeyStore

    expect(reloaded.getState().hotkeys).toHaveLength(expected.length)
    expect(reloaded.getState().hotkeys[0].bindings[0]).toMatchObject({ key: 'F9' })
  })

  it('keeps the chosen transition', async () => {
    const { useTransitionStore } = await import('../../src/stores/transitionStore')
    useTransitionStore.getState().setType('wipe')
    useTransitionStore.getState().setDuration(750)

    vi.resetModules()
    const reloaded = (await import('../../src/stores/transitionStore')).useTransitionStore

    expect(reloaded.getState().type).toBe('wipe')
    expect(reloaded.getState().durationMs).toBe(750)
  })

  it('keeps changed settings, including the base resolution', async () => {
    const { useSettingsStore } = await import('../../src/stores/settingsStore')
    useSettingsStore.getState().updateVideo({ baseResolution: { width: 2560, height: 1440 } })

    vi.resetModules()
    const reloaded = (await import('../../src/stores/settingsStore')).useSettingsStore

    expect(reloaded.getState().video.baseResolution).toEqual({ width: 2560, height: 1440 })
  })
})
