import { describe, it, expect } from 'vitest'
import { describeStartupFailure } from '../../electron/main/startup'
import { SchemaTooNewError } from '../../electron/main/db'

/**
 * The window is not created until the database is open, so a failure there
 * used to mean the app never appeared. This message is all the person gets.
 */
describe('describeStartupFailure', () => {
  it('passes a newer-data message through untouched', () => {
    const err = new SchemaTooNewError(5, 2)
    expect(describeStartupFailure(err)).toBe(err.message)
  })

  it('tells them to install the latest version when the data is newer', () => {
    expect(describeStartupFailure(new SchemaTooNewError(5, 2))).toMatch(/latest/i)
  })

  it('explains an unreadable data file and includes the reason', () => {
    const text = describeStartupFailure(new Error('database is locked'))

    expect(text).toContain('could not open its data file')
    expect(text).toContain('database is locked')
  })

  it('reassures them nothing was changed', () => {
    expect(describeStartupFailure(new Error('x'))).toMatch(/has not been changed/)
  })

  it('says where the log is', () => {
    expect(describeStartupFailure(new Error('x'))).toContain('logs')
  })

  it('copes with something that is not an Error', () => {
    expect(describeStartupFailure('disk full')).toContain('disk full')
    expect(() => describeStartupFailure(undefined)).not.toThrow()
  })
})
