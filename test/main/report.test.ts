import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  formatDiagnostics, scrubLogLine, readLogTail, type DiagnosticsInput,
} from '../../electron/main/diagnostics/report'

/**
 * The diagnostics text is what a tester pastes into a public bug report, so it
 * must be useful to read and must never carry a stream key.
 */

const base: DiagnosticsInput = {
  appVersion: '0.6.0',
  electronVersion: '43.3.0',
  platform: 'win32',
  arch: 'x64',
  osRelease: '10.0.26200',
  totalMemoryMB: 16384,
  ffmpeg: { path: 'C:\\app\\resources\\ffmpeg\\ffmpeg.exe', bundled: true, version: 'ffmpeg version 8.1.1' },
  schemaVersion: 1,
  logTail: ['[2026-10-02T09:55:01.997Z] INFO  --- session start ---'],
  generatedAt: new Date('2026-10-02T10:00:00.000Z'),
}

describe('formatDiagnostics', () => {
  it('states the version, system, FFmpeg and data version', () => {
    const text = formatDiagnostics(base)

    expect(text).toContain('Version:   0.6.0 (Electron 43.3.0)')
    expect(text).toContain('win32 x64 (10.0.26200), 16384 MB RAM')
    expect(text).toContain('bundled — ffmpeg version 8.1.1')
    expect(text).toContain('schema v1')
  })

  it('says whether FFmpeg came from the app or the PATH', () => {
    const onPath = formatDiagnostics({ ...base, ffmpeg: { path: 'ffmpeg', bundled: false, version: 'ffmpeg version 7.0' } })
    expect(onPath).toContain('system PATH — ffmpeg version 7.0')
  })

  // The most common first question about a recording problem.
  it('says plainly when FFmpeg was not found, and where it looked', () => {
    const text = formatDiagnostics({ ...base, ffmpeg: { path: 'ffmpeg', bundled: false, version: null } })

    expect(text).toContain('NOT FOUND')
    expect(text).toContain('looked for: ffmpeg')
  })

  it('says when the database could not be read', () => {
    expect(formatDiagnostics({ ...base, schemaVersion: null })).toContain('unreadable')
  })

  it('includes the log, and copes with there being none', () => {
    expect(formatDiagnostics(base)).toContain('session start')
    expect(formatDiagnostics({ ...base, logTail: [] })).toContain('(no log entries)')
  })

  it('reports how many log lines it is showing', () => {
    expect(formatDiagnostics({ ...base, logTail: ['a', 'b', 'c'] })).toContain('last 3 lines')
  })

  it('stamps when it was generated', () => {
    expect(formatDiagnostics(base)).toContain('2026-10-02T10:00:00.000Z')
  })

  it('scrubs secrets from the log it includes', () => {
    const text = formatDiagnostics({
      ...base,
      logTail: ['INFO started rtmp://live.twitch.tv/app/live_123456_SECRETKEY'],
    })

    expect(text).not.toContain('SECRETKEY')
  })
})

describe('scrubLogLine', () => {
  it('removes the stream key from an RTMP target', () => {
    const out = scrubLogLine('start rtmp://live.twitch.tv/app/live_123_abcdef ok')

    expect(out).not.toContain('live_123_abcdef')
    expect(out).toContain('rtmp://live.twitch.tv/app/')
  })

  it('handles rtmps', () => {
    expect(scrubLogLine('rtmps://a.example/live/KEY123')).not.toContain('KEY123')
  })

  it('removes secret values from JSON the logger wrote', () => {
    const out = scrubLogLine('INFO stream {"streamKey":"abc123","url":"x"}')

    expect(out).not.toContain('abc123')
    expect(out).toContain('"url":"x"')
  })

  it.each(['stream_key', 'password', 'token', 'secret', 'apiKey', 'api_key'])('removes a %s value', (key) => {
    const out = scrubLogLine(`INFO {"${key}":"hunter2-value"}`)
    expect(out).not.toContain('hunter2-value')
  })

  it('removes key=value pairs in plain text', () => {
    expect(scrubLogLine('failed with token=abc123 retrying')).not.toContain('abc123')
    expect(scrubLogLine('password: hunter2')).not.toContain('hunter2')
  })

  it('leaves an ordinary line alone', () => {
    const line = '[2026-10-02T09:55:01.997Z] INFO  recording started to C:\\Videos\\Recording.mkv'
    expect(scrubLogLine(line)).toBe(line)
  })
})

describe('readLogTail', () => {
  const dirs: string[] = []
  const logWith = (content: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-log-'))
    dirs.push(dir)
    const file = path.join(dir, 'main.log')
    fs.writeFileSync(file, content)
    return file
  }
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

  it('returns the last lines in order', () => {
    const file = logWith(Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n'))
    expect(readLogTail(file, 3)).toEqual(['line 7', 'line 8', 'line 9'])
  })

  it('returns everything when the log is short', () => {
    expect(readLogTail(logWith('a\nb\n'), 80)).toEqual(['a', 'b'])
  })

  it('copes with Windows line endings', () => {
    expect(readLogTail(logWith('a\r\nb\r\nc\r\n'), 2)).toEqual(['b', 'c'])
  })

  it('reads only the end of a very large log, without a torn first line', () => {
    const big = Array.from({ length: 20000 }, (_, i) => `entry number ${i} padding padding padding`).join('\n')
    const tail = readLogTail(logWith(big), 5)

    expect(tail).toHaveLength(5)
    expect(tail.at(-1)).toBe('entry number 19999 padding padding padding')
    expect(tail.every((l) => l.startsWith('entry number'))).toBe(true)
  })

  it('returns nothing for a log that does not exist', () => {
    expect(readLogTail(path.join(os.tmpdir(), 'cb-no-such-log.log'))).toEqual([])
  })

  it('returns nothing for an empty log', () => {
    expect(readLogTail(logWith(''))).toEqual([])
  })
})
