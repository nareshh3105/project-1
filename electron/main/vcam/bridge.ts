import net from 'node:net'
import { VCAM_FRAME_BYTES, VCAM_PORT } from './frames'

/**
 * The way pictures get from the app to the camera.
 *
 * The camera runs inside a Windows service, in a different session from the
 * app, so it cannot share memory with it. It connects here, over the loopback
 * interface (never reachable from another computer), and is sent the pictures.
 * Only one camera is served at a time. With nobody connected, pictures are
 * dropped; with a slow reader, the oldest are dropped, so the camera always
 * shows something recent and the app never builds up a backlog.
 */

/** How many whole pictures may wait to be written before the next one is dropped. */
const MAX_QUEUED_FRAMES = 3

export class FrameBridge {
  private server: net.Server | null = null
  private client: net.Socket | null = null
  private sent = 0
  private dropped = 0

  constructor(
    private readonly port = VCAM_PORT,
    private readonly frameBytes = VCAM_FRAME_BYTES,
  ) {}

  /** Starts listening. Rejects, with a message to show, if the port is taken. */
  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        // One camera. A second connection is not the camera.
        if (this.client) { socket.destroy(); return }
        this.client = socket
        socket.setNoDelay(true)
        socket.on('error', () => { /* the camera went away */ })
        socket.on('close', () => { if (this.client === socket) this.client = null })
      })
      server.once('error', (err: NodeJS.ErrnoException) => {
        reject(err.code === 'EADDRINUSE'
          ? new Error(`Another program is using port ${this.port}, which the virtual camera needs.`)
          : err)
      })
      // Loopback only.
      server.listen(this.port, '127.0.0.1', () => { this.server = server; resolve() })
    })
  }

  /** Sends one picture to the camera, if it is connected and keeping up. */
  push(frame: Buffer): boolean {
    const socket = this.client
    if (!socket || socket.destroyed || frame.length !== this.frameBytes) return false
    if (socket.writableLength > this.frameBytes * MAX_QUEUED_FRAMES) {
      this.dropped++
      return false
    }
    socket.write(frame)
    this.sent++
    return true
  }

  get connected(): boolean {
    return this.client !== null && !this.client.destroyed
  }

  stats() {
    return { sent: this.sent, dropped: this.dropped, connected: this.connected }
  }

  close(): Promise<void> {
    this.client?.destroy()
    this.client = null
    const server = this.server
    this.server = null
    return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()))
  }
}
