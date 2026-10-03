import { desktopCapturer, type Session } from 'electron'
import { command } from '../ipc'
import { CaptureBroker, type CaptureKind } from '../capture/broker'

/** Thumbnails are small: a picker shows many of them at once. */
const THUMBNAIL = { width: 320, height: 180 }

export const captureBroker = new CaptureBroker(async (kinds: CaptureKind[]) =>
  desktopCapturer.getSources({
    types: kinds,
    thumbnailSize: THUMBNAIL,
    fetchWindowIcons: true,
  }),
)

/**
 * Answers getDisplayMedia from the renderer. Without this handler the call
 * fails outright on Windows. With it, only a choice the user just made in the
 * picker is granted; anything else is refused.
 */
export function installDisplayMediaHandler(ses: Session) {
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    captureBroker
      .resolve()
      .then((grant) => callback(grant ?? {}))
      .catch(() => callback({}))
  })
}

export function registerCaptureCommands() {
  command('list_capture_sources', ({ kinds }) => {
    const wanted = Array.isArray(kinds) && kinds.length > 0 ? (kinds as CaptureKind[]) : undefined
    return captureBroker.listSources(wanted)
  })

  command('prepare_capture', ({ sourceId, audio }) => {
    captureBroker.prepare(String(sourceId ?? ''), Boolean(audio))
  })
}
