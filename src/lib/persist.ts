/**
 * Reading persisted state out of localStorage.
 *
 * Wrapping `JSON.parse` in try/catch looks like it makes a read safe, but it
 * only catches malformed *syntax*. `JSON.parse('null')` returns null, and
 * `JSON.parse('{}')` returns an object where an array was expected — both
 * succeed, escape the catch, and land in the store. The app then dies later,
 * when a component maps over the value, leaving a blank window that survives a
 * restart because the bad entry is still on disk.
 *
 * So every read states the shape it expects and falls back when it does not
 * get it. Storage is shared with anything else on the origin, persists across
 * upgrades that change a schema, and is editable by hand: it is untrusted
 * input, not a typed value that happens to live on disk.
 */

/** Reads `key`, returning `fallback()` unless the stored value satisfies `accept`. */
export function readPersisted<T>(
  key: string,
  accept: (value: unknown) => value is T,
  fallback: () => T,
): T {
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return fallback() // private mode, or storage disabled entirely
  }
  if (raw === null) return fallback()

  try {
    const parsed: unknown = JSON.parse(raw)
    return accept(parsed) ? parsed : fallback()
  } catch {
    return fallback()
  }
}

/** Writes `value` as JSON, ignoring a full or unavailable quota. */
export function writePersisted(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* nothing useful to do; the in-memory state is still correct */ }
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** An array whose every element satisfies `item`. */
export const isArrayOf =
  <T>(item: (v: unknown) => v is T) =>
  (v: unknown): v is T[] =>
    Array.isArray(v) && v.every(item)
