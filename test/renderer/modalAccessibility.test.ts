import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Every dialog must describe itself. Radix wires aria-describedby from a
 * Dialog.Description; without one a screen reader announces the title and
 * nothing else, and Radix logs a warning on every open.
 *
 * This reads the sources rather than rendering each modal, because the
 * modals take different props and stores and this is a structural rule:
 * anyone adding a dialog gets the failure the moment they forget.
 */
const dir = path.resolve(__dirname, '../../src/components/modals')

const dialogs = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ file: f, source: fs.readFileSync(path.join(dir, f), 'utf8') }))
  .filter(({ source }) => source.includes('Dialog.Content'))

describe('modal dialogs', () => {
  it('finds the dialogs', () => {
    expect(dialogs.length).toBeGreaterThan(10)
  })

  it.each(dialogs.map((d) => [d.file, d.source]))('%s has a description', (_file, source) => {
    expect(source).toContain('Dialog.Description')
  })

  it.each(dialogs.map((d) => [d.file, d.source]))('%s has a title', (_file, source) => {
    expect(source).toContain('Dialog.Title')
  })
})
