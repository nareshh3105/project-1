/**
 * Getting a screen or system-audio stream is a two-step handshake with the main
 * process: declare the choice, then ask for it. Two handshakes in one window at
 * the same time would cross, and one of them would be granted the other's
 * choice (or refused with "Invalid capture constraints"). This runs them one
 * at a time, in order, whether or not an earlier one fails.
 */
let tail: Promise<unknown> = Promise.resolve()

export function exclusively<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task)
  tail = run.catch(() => {})
  return run
}
