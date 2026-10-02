import { SchemaTooNewError } from './db'

/**
 * What to tell the user when the app cannot start.
 *
 * Shown in a native dialog because nothing else exists yet: the window is not
 * created until the database is open, so a failure used to mean the app simply
 * never appeared and the person had no way to know why.
 */
export function describeStartupFailure(err: unknown): string {
  // This one already says what happened and what to do.
  if (err instanceof SchemaTooNewError) return err.message

  const reason = err instanceof Error ? err.message : String(err)
  return (
    'CodeBuilders could not open its data file, so it cannot start.\n\n' +
    `${reason}\n\n` +
    'Your data has not been changed. Another program may be holding the file, ' +
    'or the disk may be full or read-only. A log with more detail is in ' +
    '%APPDATA%\\CodeBuilders\\logs.'
  )
}
