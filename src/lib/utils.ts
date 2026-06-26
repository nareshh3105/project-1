import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn/ui standard helper — merges Tailwind classes safely
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Formatting ────────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return h > 0
    ? `${h}:${pad(m)}:${pad(s)}`
    : `${pad(m)}:${pad(s)}`
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

export function formatBitrate(bps: number): string {
  if (bps < 1000)    return `${bps} bps`
  if (bps < 1000000) return `${(bps / 1000).toFixed(0)} Kbps`
  return `${(bps / 1000000).toFixed(2)} Mbps`
}

export function formatDb(db: number | null): string {
  if (db === null || db <= -100) return '-∞'
  return `${db.toFixed(1)} dB`
}

// ── Volume / dB conversions ───────────────────────────────────────────────

// Linear amplitude (0–1) to dBFS
export function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity
  return 20 * Math.log10(linear)
}

// dBFS to linear amplitude (0–1)
export function dbToLinear(db: number): number {
  if (db <= -100) return 0
  return Math.pow(10, db / 20)
}

// Fader position (0–1) to dB — OBS uses cubic scaling
export function faderToDb(pos: number): number {
  if (pos <= 0) return -Infinity
  if (pos >= 1) return 0
  return (pos ** (1 / 3) - 1) * 100
}

export function dbToFader(db: number): number {
  if (db <= -100) return 0
  if (db >= 0)    return 1
  return ((db / 100) + 1) ** 3
}

// ── Misc ──────────────────────────────────────────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function generateId(): string {
  return crypto.randomUUID()
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}
