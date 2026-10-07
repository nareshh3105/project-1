import { ipcMain } from 'electron'
import { HOST_CHANNELS, type OutputKind } from '../../../shared/host'

/**
 * Routes the host's encoded output to the FFmpeg process waiting for it.
 *
 * Each running output has one sink, FFmpeg's standard input. The host sends
 * chunks tagged with the kind of output they belong to; this finds the sink and
 * writes. Chunks for an output that is not running (a late one after a stop, or
 * a confused sender) are dropped rather than allowed to throw.
 */

export interface Sink {
  write(chunk: Buffer): unknown
  /** False once the process behind it has gone. */
  writable?: boolean
}

const KINDS: readonly string[] = ['recording', 'streaming', 'replay', 'virtualCamera']

/**
 * A sink is named for its output ("recording"), or for one of that output's
 * extra audio tracks ("recording#2", "recording#3").
 */
const sinks = new Map<string, Sink>()

export function registerSink(name: OutputKind | `${OutputKind}#${number}`, sink: Sink): void {
  sinks.set(name, sink)
}

export function unregisterSink(name: OutputKind | `${OutputKind}#${number}`): void {
  sinks.delete(name)
}

export const hasSink = (name: string) => sinks.has(name)

/** Accepts the byte containers Electron's IPC can deliver. */
export function toBuffer(data: unknown): Buffer | null {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  return null
}

/** Writes a chunk to the output's sink. Returns whether it was delivered. */
export function pushChunk(kind: string, data: unknown): boolean {
  // "recording#2" is the second track of a recording.
  const base = kind.split('#')[0]
  if (!KINDS.includes(base) || !/^[a-zA-Z]+(#[2-9])?$/.test(kind)) return false

  const sink = sinks.get(kind)
  if (!sink || sink.writable === false) return false

  const buffer = toBuffer(data)
  if (!buffer || buffer.length === 0) return false

  sink.write(buffer)
  return true
}

/**
 * Listens for chunks from the host. Only the host's own page may feed an
 * output; anything else on the channel is ignored.
 */
export function installIngest(isHostSender: (senderId: number) => boolean): void {
  ipcMain.on(HOST_CHANNELS.ingest, (event, kind: string, data: unknown) => {
    if (!isHostSender(event.sender.id)) return
    pushChunk(kind, data)
  })
}
