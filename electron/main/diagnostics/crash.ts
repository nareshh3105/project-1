import { app, crashReporter, type BrowserWindow } from 'electron'
import { log } from './logger'

/**
 * Crash and unhandled-error capture (NF-26).
 *
 * Everything is recorded locally. Native crash dumps are collected but never
 * uploaded: crashReporter is started with no submit URL and uploads disabled,
 * so dumps sit in the crash directory for a user to send deliberately. Turning
 * on transmission requires an explicit opt-in (DC-14), which does not exist
 * yet and is not implied by installing the application.
 */

export function installCrashHandlers() {
  crashReporter.start({
    // No submitURL — dumps are written locally and go nowhere.
    submitURL: '',
    uploadToServer: false,
    compress: true,
  })

  // A main-process exception would otherwise terminate silently.
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception in main', serialise(err))
  })

  process.on('unhandledRejection', (reason) => {
    log.error('unhandled promise rejection in main', serialise(reason))
  })

  app.on('child-process-gone', (_event, details) => {
    // Covers the GPU and utility processes, not ffmpeg — that is a plain
    // child process and is reported by the output layer instead.
    log.error('child process gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      name: details.name,
    })
  })

  app.on('before-quit', () => log.info('quitting'))
}

/** Attaches per-window handlers. Call for each window after creation. */
export function watchWindow(win: BrowserWindow) {
  win.webContents.on('render-process-gone', (_event, details) => {
    log.error('renderer process gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })

  win.webContents.on('unresponsive', () => log.warn('renderer unresponsive'))
  win.webContents.on('responsive', () => log.info('renderer responsive again'))

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    // Without the preload the interface has no backend at all, so this is
    // worth recording distinctly from a generic renderer failure.
    log.error('preload failed to load', { preloadPath, message: error.message })
  })
}

/** Normalises a thrown value into something loggable. */
export function serialise(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack }
  }
  return { value: String(err) }
}
