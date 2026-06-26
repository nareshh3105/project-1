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

// Normalize any thrown value into a readable string
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'An unknown error occurred'
}
