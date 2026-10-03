import { ipc } from '@/ipc'
import { useSettingsStore } from '@/stores/settingsStore'
import { outputParams } from '@/lib/hostSnapshot'

/**
 * Starts the outputs with the encoding settings the user has chosen.
 *
 * Every way of starting one (the buttons, the menu, a hotkey) goes through
 * here, so they all produce the same thing.
 */

const settings = () => useSettingsStore.getState()

export const startRecording = (outputPath?: string) =>
  ipc.output.startRecording(outputPath, settings().recording.format, outputParams(settings(), 'recording'))

export const startStreaming = (rtmpUrl: string, streamKey: string) =>
  ipc.output.startStreaming(rtmpUrl, streamKey, outputParams(settings(), 'streaming'))

export const startReplayBuffer = (seconds = 30) =>
  ipc.replay.start(seconds, outputParams(settings(), 'replay'))

export const startVirtualCamera = () =>
  ipc.output.startVirtualCamera(outputParams(settings(), 'virtualCamera'))
