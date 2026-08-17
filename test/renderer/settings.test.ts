// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Settings and profiles both persist to localStorage and are read back on the
 * next launch, so a shape mismatch between what is written and what is
 * expected loses user configuration silently.
 */

async function freshStores() {
  vi.resetModules()
  localStorage.clear()
  const settings = await import('../../src/stores/settingsStore')
  const profiles = await import('../../src/stores/profileStore')
  return { settings, profiles }
}

let s: Awaited<ReturnType<typeof freshStores>>['settings']
let p: Awaited<ReturnType<typeof freshStores>>['profiles']

beforeEach(async () => {
  const stores = await freshStores()
  s = stores.settings
  p = stores.profiles
})

describe('settingsStore', () => {
  it('starts from the documented defaults', () => {
    const state = s.useSettingsStore.getState()
    expect(state.general).toEqual(s.DEFAULT_GENERAL)
    expect(state.video).toEqual(s.DEFAULT_VIDEO)
    expect(state.audio).toEqual(s.DEFAULT_AUDIO)
    expect(state.recording).toEqual(s.DEFAULT_RECORDING)
  })

  it('applies a partial update without clearing the rest of the section', () => {
    s.useSettingsStore.getState().updateGeneral({ confirmOnExit: false })
    const { general } = s.useSettingsStore.getState()

    expect(general.confirmOnExit).toBe(false)
    expect(general.language).toBe(s.DEFAULT_GENERAL.language)
  })

  it('persists an update to localStorage', () => {
    s.useSettingsStore.getState().updateRecording({ format: 'mp4' })
    const stored = JSON.parse(localStorage.getItem('cb:settings') ?? '{}')
    expect(stored.recording.format).toBe('mp4')
  })

  it('persists every section, not just the one that changed', () => {
    s.useSettingsStore.getState().updateVideo({ fps: 60 })
    const stored = JSON.parse(localStorage.getItem('cb:settings') ?? '{}')

    expect(Object.keys(stored).sort()).toEqual(
      ['audio', 'general', 'recording', 'video'],
    )
  })

  it('restores persisted values on reload', async () => {
    s.useSettingsStore.getState().updateRecording({ format: 'mp4' })

    vi.resetModules()
    const reloaded = await import('../../src/stores/settingsStore')

    expect(reloaded.useSettingsStore.getState().recording.format).toBe('mp4')
  })

  it('falls back to defaults when stored settings are corrupt', async () => {
    localStorage.setItem('cb:settings', '{ not json')
    vi.resetModules()

    const reloaded = await import('../../src/stores/settingsStore')

    expect(reloaded.useSettingsStore.getState().general).toEqual(
      reloaded.DEFAULT_GENERAL,
    )
  })

  it('backfills a section missing from older stored settings', async () => {
    // Written by a build that predates the recording section.
    localStorage.setItem(
      'cb:settings',
      JSON.stringify({ general: s.DEFAULT_GENERAL, video: s.DEFAULT_VIDEO, audio: s.DEFAULT_AUDIO }),
    )
    vi.resetModules()

    const reloaded = await import('../../src/stores/settingsStore')

    expect(reloaded.useSettingsStore.getState().recording).toEqual(
      reloaded.DEFAULT_RECORDING,
    )
  })

  it('replaces every section on applyAll', () => {
    const draft = {
      general: { ...s.DEFAULT_GENERAL, confirmOnExit: false },
      video: { ...s.DEFAULT_VIDEO, fps: 60 as const },
      audio: { ...s.DEFAULT_AUDIO, channels: 1 as const },
      recording: { ...s.DEFAULT_RECORDING, format: 'mp4' as const },
    }

    s.useSettingsStore.getState().applyAll(draft)
    const state = s.useSettingsStore.getState()

    expect(state.video.fps).toBe(60)
    expect(state.recording.format).toBe('mp4')
    expect(state.audio.channels).toBe(1)
  })
})

describe('profileStore', () => {
  it('creates a default profile on first run', () => {
    const { profiles, activeProfileId } = p.useProfileStore.getState()
    expect(profiles).toHaveLength(1)
    expect(profiles[0].name).toBe('Default')
    expect(activeProfileId).toBe(profiles[0].id)
  })

  // Regression: captureSettings() and defaultProfile() once built a
  // SettingsState without the recording section. TypeScript caught it, but a
  // profile saved through that path would have silently dropped the user's
  // output format and audio track selection on switch.
  it('captures every settings section when creating a profile', () => {
    s.useSettingsStore.getState().updateRecording({ format: 'mp4' })

    p.useProfileStore.getState().createProfile('Streaming')
    const created = p.useProfileStore
      .getState()
      .profiles.find((x) => x.name === 'Streaming')!

    expect(Object.keys(created.settings).sort()).toEqual(
      ['audio', 'general', 'recording', 'video'],
    )
    expect(created.settings.recording.format).toBe('mp4')
  })

  it('gives the default profile a complete settings shape', () => {
    const [def] = p.useProfileStore.getState().profiles
    expect(Object.keys(def.settings).sort()).toEqual(
      ['audio', 'general', 'recording', 'video'],
    )
  })

  it('restores captured settings when switching profiles', () => {
    const store = p.useProfileStore.getState()

    s.useSettingsStore.getState().updateRecording({ format: 'mp4' })
    store.createProfile('MP4 profile')
    const mp4Id = p.useProfileStore.getState().activeProfileId!

    s.useSettingsStore.getState().updateRecording({ format: 'mkv' })
    store.createProfile('MKV profile')

    p.useProfileStore.getState().switchProfile(mp4Id)

    expect(s.useSettingsStore.getState().recording.format).toBe('mp4')
  })

  it('refuses to delete the last remaining profile', () => {
    const store = p.useProfileStore.getState()
    store.deleteProfile(store.profiles[0].id)
    expect(p.useProfileStore.getState().profiles).toHaveLength(1)
  })

  it('activates another profile after deleting the active one', () => {
    const store = p.useProfileStore.getState()
    store.createProfile('Second')

    const activeId = p.useProfileStore.getState().activeProfileId!
    p.useProfileStore.getState().deleteProfile(activeId)

    const after = p.useProfileStore.getState()
    expect(after.profiles).toHaveLength(1)
    expect(after.activeProfileId).toBe(after.profiles[0].id)
  })

  it('renames a profile', () => {
    const store = p.useProfileStore.getState()
    store.renameProfile(store.profiles[0].id, 'Renamed')
    expect(p.useProfileStore.getState().profiles[0].name).toBe('Renamed')
  })

  it('duplicates a profile without changing the original', () => {
    const store = p.useProfileStore.getState()
    store.duplicateProfile(store.profiles[0].id)

    const { profiles } = p.useProfileStore.getState()
    expect(profiles).toHaveLength(2)
    expect(profiles[1].name).toBe('Default (copy)')
    expect(profiles[1].id).not.toBe(profiles[0].id)
  })

  it('survives a reload with its profiles intact', async () => {
    p.useProfileStore.getState().createProfile('Persisted')

    vi.resetModules()
    const reloaded = await import('../../src/stores/profileStore')

    expect(
      reloaded.useProfileStore.getState().profiles.map((x) => x.name),
    ).toContain('Persisted')
  })
})
