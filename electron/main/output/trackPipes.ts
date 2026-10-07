import net from 'node:net'
import crypto from 'node:crypto'

/**
 * Named pipes that carry the extra audio tracks of a recording to FFmpeg.
 *
 * FFmpeg reads the picture and the first track from standard input. The other
 * tracks are files of sound alone, each on a pipe of its own that FFmpeg opens
 * as another input. Each pipe is a server here that FFmpeg connects to; what the
 * host sends before FFmpeg has connected is held and delivered on connection.
 */

export interface TrackPipe {
  /** The path FFmpeg opens. */
  readonly path: string
  write(chunk: Buffer): void
  readonly writable: boolean
  /** Delivers what is held, then closes the pipe so FFmpeg sees the end of its input. */
  end(): Promise<void>
  /** Drops everything and closes at once. */
  destroy(): void
}

/** The most that is held for a pipe FFmpeg has not yet connected to. */
const MAX_HELD_BYTES = 64 * 1024 * 1024

export const pipePath = (token: string) => `\\\\.\\pipe\\codebuilders-${process.pid}-${token}`

/**
 * `waitMs` is how long, once the end is asked for, to wait for a reader that has
 * not yet connected: FFmpeg opens its inputs one after another, so a recording
 * stopped in its first moments may be ended before FFmpeg has reached this one.
 */
export function createTrackPipe(waitMs = 3000): Promise<TrackPipe> {
  const token = crypto.randomBytes(6).toString('hex')
  const path = pipePath(token)
  const held: Buffer[] = []
  let heldBytes = 0
  let socket: net.Socket | null = null
  let ending = false
  let closed = false
  let finish: (() => void) | null = null

  const server = net.createServer((s) => {
    // One reader. A second connection would be someone other than FFmpeg.
    if (socket) { s.destroy(); return }
    socket = s
    s.on('error', () => { /* the reader went away; nothing more can be delivered */ })
    s.on('close', () => { closed = true; server.close(); finish?.() })
    for (const chunk of held.splice(0)) s.write(chunk)
    heldBytes = 0
    if (ending) s.end()
  })

  const pipe: TrackPipe = {
    path,
    get writable() { return !closed && !ending },
    write(chunk) {
      if (closed || ending) return
      if (socket) { socket.write(chunk); return }
      if (heldBytes + chunk.length > MAX_HELD_BYTES) return // FFmpeg never came; do not grow without limit
      held.push(chunk)
      heldBytes += chunk.length
    },
    end() {
      if (closed) return Promise.resolve()
      ending = true
      return new Promise<void>((resolve) => {
        finish = resolve
        if (socket) {
          socket.end()
          // FFmpeg normally closes its end on reaching the end of the input; do not wait for ever if it does not.
          setTimeout(() => { socket?.destroy(); resolve() }, 5000).unref()
        }
        else {
          // No one has connected. Wait a little in case FFmpeg is on its way, then give up.
          setTimeout(() => {
            if (socket) return // it came, and the connection's own close ends this
            closed = true
            server.close()
            resolve()
          }, waitMs).unref()
        }
      })
    },
    destroy() {
      closed = true
      held.length = 0
      socket?.destroy()
      server.close()
    },
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => resolve(pipe))
  })
}
