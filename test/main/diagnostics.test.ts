import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { redact, write, _setLogFileForTests } from '../../electron/main/diagnostics/logger'
import { serialise } from '../../electron/main/diagnostics/crash'

let dir: string
let logFile: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-log-'))
  logFile = path.join(dir, 'main.log')
  _setLogFileForTests(logFile)
  // Logging mirrors to the console; keep the test output readable.
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  _setLogFileForTests(null)
  fs.rmSync(dir, { recursive: true, force: true })
})

const contents = () => fs.readFileSync(logFile, 'utf8')

describe('redaction (NF-3, DC-15)', () => {
  it('removes a stream key', () => {
    expect(redact({ streamKey: 'live_12345_secret' })).toEqual({
      streamKey: '[redacted]',
    })
  })

  it('matches the key name whatever its casing or separator', () => {
    const out = redact({
      streamKey: 'a', stream_key: 'b', StreamKey: 'c', rtmpStreamKey: 'd',
    }) as Record<string, string>

    expect(Object.values(out).every((v) => v === '[redacted]')).toBe(true)
  })

  it('removes passwords, tokens, secrets and api keys', () => {
    const out = redact({
      password: 'p', token: 't', secret: 's', apiKey: 'k', api_key: 'k2',
    }) as Record<string, string>

    expect(Object.values(out).every((v) => v === '[redacted]')).toBe(true)
  })

  // The RTMP target is built as <url>/<key>, so the URL carries the secret
  // even when the key was supplied separately.
  it('strips the key from an RTMP URL', () => {
    expect(redact('rtmp://live.twitch.tv/app/live_99887766_abcdef')).toBe(
      'rtmp://live.twitch.tv/app/[redacted]',
    )
  })

  it('strips it from rtmps as well', () => {
    expect(redact('rtmps://live.example.com/app/mysecretkey')).toBe(
      'rtmps://live.example.com/app/[redacted]',
    )
  })

  it('reaches secrets nested inside other objects', () => {
    const out = redact({ config: { stream: { streamKey: 'secret' } } }) as {
      config: { stream: { streamKey: string } }
    }
    expect(out.config.stream.streamKey).toBe('[redacted]')
  })

  it('reaches secrets inside arrays', () => {
    const out = redact([{ streamKey: 'a' }, { streamKey: 'b' }]) as { streamKey: string }[]
    expect(out.map((x) => x.streamKey)).toEqual(['[redacted]', '[redacted]'])
  })

  it('leaves ordinary values alone', () => {
    expect(redact({ filePath: 'C:/Videos/a.mkv', fps: 30 })).toEqual({
      filePath: 'C:/Videos/a.mkv',
      fps: 30,
    })
  })

  it('does not mangle a plain URL with no key', () => {
    expect(redact('https://ffmpeg.org/download.html')).toBe(
      'https://ffmpeg.org/download.html',
    )
  })

  it('stops rather than recursing forever on a cycle', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(() => redact(a)).not.toThrow()
  })
})

describe('write', () => {
  it('creates the log file and records the message', () => {
    write('info', 'recording started')
    expect(contents()).toContain('recording started')
  })

  it('tags the level', () => {
    write('error', 'ffmpeg failed')
    expect(contents()).toContain('ERROR')
  })

  it('timestamps each line', () => {
    write('info', 'x')
    expect(contents()).toMatch(/\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\]/)
  })

  it('appends rather than overwriting', () => {
    write('info', 'first')
    write('info', 'second')

    expect(contents()).toContain('first')
    expect(contents()).toContain('second')
  })

  // The whole point of redaction is that it applies on the way to disk.
  it('never writes a secret to the file', () => {
    write('info', 'starting stream', {
      rtmpUrl: 'rtmp://live.twitch.tv/app',
      streamKey: 'live_99887766_supersecret',
    })

    const text = contents()
    expect(text).not.toContain('supersecret')
    expect(text).toContain('[redacted]')
  })

  it('does not throw when the path is unwritable', () => {
    _setLogFileForTests(path.join(dir, 'no', 'such', 'dir', 'main.log'))
    expect(() => write('info', 'x')).not.toThrow()
  })

  it('survives a value that cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => write('info', 'cyclic', cyclic)).not.toThrow()
  })
})

describe('serialise', () => {
  it('keeps the message and stack of an Error', () => {
    const out = serialise(new Error('boom'))
    expect(out.message).toBe('boom')
    expect(out.stack).toBeTruthy()
  })

  it('keeps the error type', () => {
    expect(serialise(new TypeError('bad'))).toMatchObject({ name: 'TypeError' })
  })

  it('handles a thrown non-Error', () => {
    expect(serialise('just a string')).toEqual({ value: 'just a string' })
  })

  it('handles a thrown null', () => {
    expect(serialise(null)).toEqual({ value: 'null' })
  })
})
