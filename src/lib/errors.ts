// Structured error types for IPC / domain layer

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class IpcError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'IPC_ERROR', context)
    this.name = 'IpcError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', { resource, id })
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', { field })
    this.name = 'ValidationError'
  }
}

/**
 * The reason a command failed, as the main process gave it.
 *
 * The main process rejects with a plain message, but Electron hands the page an
 * Error whose message is that text behind "Error invoking remote method 'cb:invoke': ".
 * Taking only strings meant every failure reached the screen as just
 * 'Command "save_replay" failed', with the reason thrown away.
 */
export function remoteMessage(err: unknown, command: string): string {
  const raw = typeof err === 'string' ? err : err instanceof Error ? err.message : ''
  const message = raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(?:Error|TypeError|RangeError):\s*/, '')
    .trim()
  return message || `Command "${command}" failed`
}

// Normalize any thrown value into a readable string
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'An unknown error occurred'
}
