import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MediaRegistry, isMediaPath, MEDIA_EXTENSIONS, SCHEME } from '../../electron/main/media/registry'
import { createMediaHandler } from '../../electron/main/media/protocol'

/**
 * The media source plays files the user picked, served through an address
 * scheme of the app itself. It must serve those files and nothing else, and
 * must let a page read the picture into a canvas.
 */

let dir: string
const file = (name: string, content = 'x') => {
  const p = path.join(dir, name)
  fs.writeFileSync(p, content)
  return p
}
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-media-')) })
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('which files count as media', () => {
  it.each(MEDIA_EXTENSIONS.map((e) => [`clip.${e}`]))('%s does', (f) => expect(isMediaPath(f)).toBe(true))
  it('ignores the case of the extension', () => expect(isMediaPath('CLIP.MP4')).toBe(true))
  it.each([['notes.txt'], ['run.exe'], ['clip.mp4.exe'], ['mp4'], ['.mp4'], [''], ['archive.zip'], ['key.pem']])('%s does not', (f) =>
    expect(isMediaPath(f)).toBe(false))
})

describe('MediaRegistry', () => {
  let registry: MediaRegistry
  beforeEach(() => { registry = new MediaRegistry() })

  it('gives a registered file an address on the scheme of the app', () => {
    expect(registry.register(file('a.mp4'))).toMatch(new RegExp(`^${SCHEME}://media/[0-9a-f-]{36}$`))
  })

  it('serves the same address for the same file every time', () => {
    const f = file('same.mp4')
    expect(registry.register(f)).toBe(registry.register(f))
  })

  it('gives different files different addresses', () => {
    expect(registry.register(file('one.mp4'))).not.toBe(registry.register(file('two.mp4')))
  })

  it('finds the file behind an address it made', () => {
    const f = file('find.webm')
    expect(registry.resolve(registry.register(f))).toBe(path.resolve(f))
  })

  it.each([
    [`${SCHEME}://media/not-registered`],
    [`${SCHEME}://other/anything`],
    ['https://media/anything'],
    ['file:///C:/Windows/System32/config/SAM'],
    ['not a url'],
    [''],
  ])('finds nothing for %s', (url) => expect(registry.resolve(url)).toBeNull())

  it('finds nothing under another host, even with a valid id', () => {
    const url = registry.register(file('host.mp4'))
    expect(registry.resolve(url.replace('://media/', '://other/'))).toBeNull()
  })

  it('does not find a path that merely looks like one', () => {
    const f = file('secret.mp4')
    registry.register(f)
    expect(registry.resolve(`${SCHEME}://media/${encodeURIComponent(f)}`)).toBeNull()
  })

  it('does not find an address made by another registry', () => {
    const other = new MediaRegistry()
    expect(registry.resolve(other.register(file('x.mp4')))).toBeNull()
  })

  it.each([['secrets.txt'], ['run.exe'], ['noextension']])('refuses %s', (name) => {
    expect(() => registry.register(file(name))).toThrow(/not a video or sound file/)
  })

  it('says so when the file has gone', () => {
    expect(() => registry.register(path.join(dir, 'missing.mp4'))).toThrow(/could not be found/)
  })

  it('refuses a folder named like a video', () => {
    const folder = path.join(dir, 'folder.mp4')
    fs.mkdirSync(folder)
    expect(() => registry.register(folder)).toThrow(/not a file/)
  })

  it.each([[undefined], [null], [''], [7], [{}]])('refuses %s as a path', (given) => {
    expect(() => registry.register(given)).toThrow(/No file was chosen/)
  })
})

describe('the handler', () => {
  let registry: MediaRegistry
  let fetched: Array<{ url: string; headers: Headers }>
  let respond: () => Response

  const handler = () => createMediaHandler(registry, async (url, headers) => { fetched.push({ url, headers }); return respond() })
  const ask = (url: string, headers: Record<string, string> = {}) =>
    handler()({ url, headers: new Headers(headers) })

  beforeEach(() => {
    registry = new MediaRegistry()
    fetched = []
    respond = () => new Response('data', { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' } })
  })

  it('serves a registered file', async () => {
    const f = file('serve.mp4')
    const res = await ask(registry.register(f))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('data')
    expect(fetched[0].url).toMatch(/^file:\/\/\//)
    expect(fetched[0].url).toContain('serve.mp4')
  })

  it('refuses anything that was not registered, without touching the disk', async () => {
    const res = await ask(`${SCHEME}://media/guess`)
    expect(res.status).toBe(404)
    expect(fetched).toHaveLength(0)
  })

  it('lets a page use the picture, which the output host needs to encode it', async () => {
    const res = await ask(registry.register(file('cors.mp4')))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin')
  })

  it('passes a range request on, so the video can seek and start part way', async () => {
    await ask(registry.register(file('range.mp4')), { Range: 'bytes=100-200' })
    expect(fetched[0].headers.get('Range')).toBe('bytes=100-200')
  })

  it('keeps the answer to a range request as a partial response', async () => {
    respond = () => new Response('part', { status: 206, headers: { 'Content-Range': 'bytes 100-103/1000' } })
    const res = await ask(registry.register(file('partial.mp4')), { Range: 'bytes=100-103' })
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 100-103/1000')
  })

  it('says ranges are accepted', async () => {
    const res = await ask(registry.register(file('ranges.mp4')))
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
  })

  it('says not found, rather than failing, if the file cannot be read after all', async () => {
    const url = registry.register(file('vanish.mp4'))
    const failing = createMediaHandler(registry, async () => { throw new Error('ENOENT') })
    const res = await failing({ url, headers: new Headers() })
    expect(res.status).toBe(404)
  })

  it('keeps the type of the file', async () => {
    const res = await ask(registry.register(file('type.mp4')))
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
  })
})
