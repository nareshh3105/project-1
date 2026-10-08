import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/**
 * The program that creates the camera.
 *
 * A camera exists only while the process that created it is running, so this
 * starts CodeBuildersCameraHost.exe and keeps it until the camera is stopped.
 * Ending the host's input is how it is told to remove the camera and exit.
 */

export interface HostProcess {
  stop(): Promise<void>
}

const STARTED = /camera started/
const START_TIMEOUT_MS = 8000
const STOP_GRACE_MS = 3000

export function startCameraHost(exe: string): Promise<HostProcess> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(exe, ['run'], { windowsHide: true, stdio: 'pipe' })
    } catch (err) {
      reject(err)
      return
    }

    let output = ''
    let settled = false
    let exited = false
    const exitWaiters: Array<() => void> = []

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      settle(() => {
        child.kill()
        reject(new Error(`The virtual camera did not start in time.${output ? `\n${output.trim()}` : ''}`))
      })
    }, START_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (text: string) => {
      output += text
      if (STARTED.test(output)) {
        settle(() => resolve({ stop: () => stop() }))
      }
    })
    child.stderr.on('data', (d: Buffer) => { output += d.toString() })
    child.stdin.on('error', () => { /* the host has gone */ })

    child.once('error', (err) => settle(() => reject(err)))
    child.once('exit', (code) => {
      exited = true
      exitWaiters.splice(0).forEach((f) => f())
      settle(() => reject(new Error(describeStartFailure(output, code))))
    })

    const stop = () =>
      new Promise<void>((done) => {
        if (exited) { done(); return }
        exitWaiters.push(done)
        try { child.stdin.end('\n') } catch { /* already closed */ }
        setTimeout(() => { if (!exited) child.kill() }, STOP_GRACE_MS).unref()
      })
  })
}

/** What went wrong, from what the host printed. */
export function describeStartFailure(output: string, code: number | null): string {
  const text = output.trim()
  // 0x80070003: the camera's DLL was not found where Windows was told it is.
  if (/0x80070003/i.test(text)) return 'Windows could not find the virtual camera. Reinstall it from the Controls panel.'
  // 0x80070005: access denied.
  if (/0x80070005/i.test(text)) return 'Windows refused to start the virtual camera (access denied).'
  return `The virtual camera could not start (exit ${code}).${text ? `\n${text}` : ''}`
}
