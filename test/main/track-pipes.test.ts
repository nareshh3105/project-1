import { describe, it, expect } from 'vitest'
import net from 'node:net'
import { createTrackPipe } from '../../electron/main/output/trackPipes'

/**
 * The extra audio tracks of a recording reach FFmpeg on named pipes. FFmpeg connects
 * some time after the host starts sending, so what comes first has to be held.
 * These use real pipes, with a client standing in for FFmpeg.
 */

function connect(path: string): Promise<{ socket: net.Socket; received: Buffer[]; ended: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const received: Buffer[] = []
    const socket = net.connect(path)
    const ended = new Promise<void>((done) => socket.on('end', () => done()))
    socket.on('data', (d) => received.push(d))
    socket.once('error', reject)
    socket.once('connect', () => resolve({ socket, received, ended }))
  })
}

const settle = () => new Promise((r) => setTimeout(r, 50))
const joined = (parts: Buffer[]) => Buffer.concat(parts).toString()

describe('a track pipe', () => {
  it('has a name FFmpeg can open as a file, different for each pipe', async () => {
    const a = await createTrackPipe()
    const b = await createTrackPipe()
    expect(a.path).toMatch(new RegExp(String.raw`^\\\\\.\\pipe\\codebuilders-\d+-[0-9a-f]+$`))
    expect(a.path).not.toBe(b.path)
    a.destroy(); b.destroy()
  })

  it('delivers what is written once the reader is connected', async () => {
    const pipe = await createTrackPipe()
    const client = await connect(pipe.path)
    pipe.write(Buffer.from('hello '))
    pipe.write(Buffer.from('world'))
    await settle()

    expect(joined(client.received)).toBe('hello world')
    pipe.destroy(); client.socket.destroy()
  })

  it('holds what was written before the reader came, and delivers it first and in order', async () => {
    const pipe = await createTrackPipe()
    pipe.write(Buffer.from('one '))
    pipe.write(Buffer.from('two '))
    const client = await connect(pipe.path)
    pipe.write(Buffer.from('three'))
    await settle()

    expect(joined(client.received)).toBe('one two three')
    pipe.destroy(); client.socket.destroy()
  })

  it('lets the reader reach the end of its input when ended', async () => {
    const pipe = await createTrackPipe()
    const client = await connect(pipe.path)
    await settle()
    pipe.write(Buffer.from('last'))
    const done = pipe.end()
    await client.ended
    client.socket.end()
    await done

    expect(joined(client.received)).toBe('last')
  })

  it('delivers held data and then the end to a reader that arrives after the end was asked for', async () => {
    const pipe = await createTrackPipe(2000)
    pipe.write(Buffer.from('early'))
    const done = pipe.end()
    expect(pipe.writable).toBe(false)

    const client = await connect(pipe.path)
    await client.ended
    client.socket.end()
    await done

    expect(joined(client.received)).toBe('early')
  })

  it('gives up on a reader that never comes', async () => {
    const pipe = await createTrackPipe(50)
    pipe.write(Buffer.from('unread'))
    await expect(pipe.end()).resolves.toBeUndefined()
    await expect(connect(pipe.path)).rejects.toBeTruthy()
  })

  it('takes nothing more once ended', async () => {
    const pipe = await createTrackPipe()
    const client = await connect(pipe.path)
    const done = pipe.end()
    pipe.write(Buffer.from('too late'))
    await client.ended
    client.socket.end()
    await done

    expect(joined(client.received)).toBe('')
    expect(pipe.writable).toBe(false)
  })

  it('turns away a second reader', async () => {
    const pipe = await createTrackPipe()
    const first = await connect(pipe.path)
    const second = await connect(pipe.path).catch(() => null)
    pipe.write(Buffer.from('data'))
    await settle()

    expect(joined(first.received)).toBe('data')
    expect(second ? joined(second.received) : '').toBe('')
    pipe.destroy(); first.socket.destroy(); second?.socket.destroy()
  })

  it('can be destroyed with data still held', async () => {
    const pipe = await createTrackPipe()
    pipe.write(Buffer.from('never read'))
    pipe.destroy()
    expect(pipe.writable).toBe(false)
    await expect(connect(pipe.path)).rejects.toBeTruthy()
  })

  it('survives the reader going away', async () => {
    const pipe = await createTrackPipe()
    const client = await connect(pipe.path)
    client.socket.destroy()
    await settle()
    expect(() => pipe.write(Buffer.from('into the void'))).not.toThrow()
    pipe.destroy()
  })
})
