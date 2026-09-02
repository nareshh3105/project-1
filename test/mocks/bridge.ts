import { vi } from 'vitest'

/**
 * Stands in for the preload's contextBridge surface.
 *
 * Components reach the backend through `src/ipc`, which reads
 * `window.codebuilders`. Installing a stub there lets a component be rendered
 * and driven without an Electron host, and lets a test assert which commands
 * were invoked.
 */

export interface BridgeStub {
  /** Commands invoked so far, in order. */
  calls: { command: string; args: Record<string, unknown> }[]
  /** Queue a result (or rejection) for a command name. */
  reply(command: string, value: unknown): void
  /** Make a command reject. */
  fail(command: string, message: string): void
  /** Push a backend event to whatever the interface subscribed with. */
  emit(event: string, payload: unknown): void
  /** Names a command was called with, for convenience in assertions. */
  argsFor(command: string): Record<string, unknown> | undefined
}

export function installBridge(): BridgeStub {
  const calls: { command: string; args: Record<string, unknown> }[] = []
  const replies = new Map<string, unknown>()
  const failures = new Map<string, string>()
  const listeners = new Map<string, ((payload: unknown) => void)[]>()

  const api = {
    invoke: vi.fn((command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args })
      if (failures.has(command)) return Promise.reject(failures.get(command))
      return Promise.resolve(replies.has(command) ? replies.get(command) : undefined)
    }),

    on: vi.fn((event: string, callback: (payload: unknown) => void) => {
      const list = listeners.get(event) ?? []
      list.push(callback)
      listeners.set(event, list)
      return () => {
        const remaining = (listeners.get(event) ?? []).filter((c) => c !== callback)
        listeners.set(event, remaining)
      }
    }),
  }

  ;(window as unknown as { codebuilders: typeof api }).codebuilders = api

  return {
    calls,
    reply: (command, value) => replies.set(command, value),
    fail: (command, message) => failures.set(command, message),
    emit: (event, payload) => {
      for (const cb of listeners.get(event) ?? []) cb(payload)
    },
    argsFor: (command) => calls.find((c) => c.command === command)?.args,
  }
}

export function removeBridge() {
  delete (window as unknown as { codebuilders?: unknown }).codebuilders
}
