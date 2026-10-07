import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Recordings go to the folder chosen in Settings, or to Videos. A folder that
 * cannot be written to must be refused when it is chosen, not discovered at the
 * end of a recording.
 */

let ff: typeof import('../../electron/main/output/ffmpeg')
let root: string

beforeEach(async () => {
  vi.resetModules()
  ff = await import('../../electron/main/output/ffmpeg')
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-folder-'))
})

afterEach(() => {
  ff.setRecordingFolder('')
  fs.rmSync(root, { recursive: true, force: true })
})

describe('the recording folder', () => {
  it('is the Videos folder until one is chosen', () => {
    expect(ff.videosDir()).toBe(path.join(os.homedir(), 'Videos'))
  })

  it('becomes the folder chosen', () => {
    const dir = path.join(root, 'clips')
    expect(ff.setRecordingFolder(dir)).toBe(dir)
    expect(ff.videosDir()).toBe(dir)
  })

  it('creates the folder, nested, if it is missing', () => {
    const dir = path.join(root, 'a', 'b', 'c')
    ff.setRecordingFolder(dir)
    expect(fs.statSync(dir).isDirectory()).toBe(true)
  })

  it('leaves nothing behind in the folder from its check', () => {
    ff.setRecordingFolder(root)
    expect(fs.readdirSync(root)).toEqual([])
  })

  it.each(['', '   ', undefined, null, 42])('goes back to the default for %j', (blank) => {
    ff.setRecordingFolder(root)
    expect(ff.setRecordingFolder(blank)).toBe(path.join(os.homedir(), 'Videos'))
    expect(ff.videosDir()).toBe(path.join(os.homedir(), 'Videos'))
  })

  it('trims spaces around the path', () => {
    expect(ff.setRecordingFolder(`  ${root}  `)).toBe(root)
  })

  it.each(['recordings', '.\\clips', '..\\x', 'clips/more'])('refuses a path that is not complete: %s', (relative) => {
    expect(() => ff.setRecordingFolder(relative)).toThrow(/not a full folder path/)
  })

  it('refuses a folder it cannot write to, and keeps the one in use', () => {
    ff.setRecordingFolder(root)
    // A file where a folder is wanted.
    const file = path.join(root, 'file.txt')
    fs.writeFileSync(file, 'x')

    expect(() => ff.setRecordingFolder(path.join(file, 'inside'))).toThrow(/Cannot save recordings in/)
    expect(ff.videosDir()).toBe(root)
  })

  it('puts files in the chosen folder', () => {
    ff.setRecordingFolder(root)
    expect(path.dirname(path.join(ff.videosDir(), 'x.mkv'))).toBe(root)
    expect(path.dirname(ff.defaultRecordingPath())).toBe(root)
  })
})
