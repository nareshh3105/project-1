import { FrameBridge } from './bridge'
import { startCameraHost } from './host'
import { FrameSplitter } from './frames'
import {
  vcamFiles, vcamState, installCamera,
  type ElevatedResult, type VcamFiles, type VcamState,
} from './install'

/**
 * The virtual camera, from the person pressing the button to pictures reaching
 * an app: make sure it is installed (asking first), run the program that creates
 * the camera, and hand it the pictures FFmpeg decodes.
 */

export interface InstallDeps {
  files(): VcamFiles | null
  state(files: VcamFiles): VcamState
  /** Asks the person, in plain words, whether to go ahead. */
  confirm(message: string): Promise<boolean>
  install(files: VcamFiles): Promise<ElevatedResult>
}

export const defaultInstallDeps = (confirm: InstallDeps['confirm']): InstallDeps => ({
  files: () => vcamFiles(),
  state: (files) => vcamState(files),
  confirm,
  install: installCamera,
})

const ASK = {
  missing:
    'The virtual camera has to be installed on this computer once, so that Zoom, Teams and other apps can use it.\n\n' +
    'Windows will ask for administrator approval. Nothing else is changed.\n\nInstall it now?',
  outdated:
    'The virtual camera needs updating to work with this version of CodeBuilders.\n\n' +
    'Windows will ask for administrator approval. Nothing else is changed.\n\nUpdate it now?',
}

/** Makes sure the camera is installed and current, installing it if the person agrees. */
export async function ensureInstalled(deps: InstallDeps): Promise<VcamFiles> {
  const files = deps.files()
  if (!files) throw new Error('This build of CodeBuilders does not include the virtual camera.')

  const before = deps.state(files)
  if (before === 'ready') return files

  if (!(await deps.confirm(ASK[before]))) throw new Error('The virtual camera was not installed.')

  const result = await deps.install(files)
  if (!result.ok) {
    throw new Error(result.cancelled
      ? 'The virtual camera was not installed: the administrator approval was declined.'
      : `The virtual camera could not be installed. ${result.message}`)
  }
  if (deps.state(files) !== 'ready') throw new Error('The virtual camera installation did not finish. Try again.')
  return files
}

export interface RunningCamera {
  /** Hands on a chunk of FFmpeg's raw output. */
  push(chunk: Buffer): void
  stop(): Promise<void>
}

/** Starts listening for the camera, then the program that creates it. */
export async function startCamera(files: VcamFiles): Promise<RunningCamera> {
  const bridge = new FrameBridge()
  await bridge.listen()

  let host
  try {
    host = await startCameraHost(files.host)
  } catch (err) {
    await bridge.close()
    throw err
  }

  const splitter = new FrameSplitter((frame) => { bridge.push(frame) })
  return {
    push: (chunk) => splitter.push(chunk),
    stop: async () => {
      await host.stop()
      await bridge.close()
    },
  }
}
