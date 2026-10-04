import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readImageAsDataUrl, MAX_IMAGE_BYTES } from '../../electron/main/commands/images'

/**
 * The image source asks the main process to read a file the user picked. That
 * must work for pictures and refuse everything else, so the same call cannot be
 * used to read arbitrary files off the machine.
 */

let dir: string
const file = (name: string, bytes: Buffer | string = 'x') => {
  const p = path.join(dir, name)
  fs.writeFileSync(p, bytes)
  return p
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-img-')) })
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('readImageAsDataUrl', () => {
  it('returns a data URL with the right type and the file contents', async () => {
    const url = await readImageAsDataUrl(file('a.png', Buffer.from([1, 2, 3, 4])))
    expect(url).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3, 4]).toString('base64')}`)
  })

  it.each([['a.jpg', 'image/jpeg'], ['b.JPEG', 'image/jpeg'], ['c.gif', 'image/gif'], ['d.webp', 'image/webp'], ['e.bmp', 'image/bmp']])(
    'labels %s as %s', async (name, mime) => {
      expect(await readImageAsDataUrl(file(name))).toMatch(new RegExp(`^data:${mime};base64,`))
    })

  it.each([['secrets.txt'], ['run.exe'], ['key.pem'], ['noextension'], ['pic.png.exe']])('refuses %s', async (name) => {
    await expect(readImageAsDataUrl(file(name))).rejects.toThrow(/not a picture/)
  })

  it('says so when the file has gone', async () => {
    await expect(readImageAsDataUrl(path.join(dir, 'missing.png'))).rejects.toThrow(/could not be found/)
  })

  it('refuses a folder named like a picture', async () => {
    const folder = path.join(dir, 'folder.png')
    fs.mkdirSync(folder)
    await expect(readImageAsDataUrl(folder)).rejects.toThrow(/not a file/)
  })

  it('refuses a picture that is too large, saying how large', async () => {
    const big = path.join(dir, 'big.png')
    fs.closeSync(fs.openSync(big, 'w'))
    fs.truncateSync(big, MAX_IMAGE_BYTES + 1)
    await expect(readImageAsDataUrl(big)).rejects.toThrow(/too large \(\d+ MB\)/)
  })

  it.each([[undefined], [null], [''], [42], [{}]])('refuses %s as a path', async (given) => {
    await expect(readImageAsDataUrl(given)).rejects.toThrow(/No image was chosen/)
  })
})
