import { command } from '../ipc'

/**
 * Audio metering moved to the renderer, where the capture streams and Web
 * Audio already live (src/lib/audio/engine.ts). The synthesised levels this
 * module used to emit are gone: they animated plausibly but measured nothing,
 * which told a user their microphone was working when it might not be.
 *
 * Volume and mute are renderer state now. They affected only the generator
 * here, never the recording — ffmpeg is given its own device arguments.
 */
export function registerAudioCommands() {
  // Preview frames are produced in the renderer via getDisplayMedia; these
  // exist so the interface's existing calls resolve rather than throw.
  command('start_preview', () => {})
  command('stop_preview', () => {})
}
