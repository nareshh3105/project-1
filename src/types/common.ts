// Shared primitive types used across the entire domain

export type ID = string

export type Timestamp = number // Unix ms

export interface Point2D {
  x: number
  y: number
}

export interface Size2D {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Transform {
  x: number
  y: number
  width: number
  height: number
  rotation: number  // degrees
  scaleX: number
  scaleY: number
}

export type LoadingState = 'idle' | 'loading' | 'success' | 'error'

export interface AsyncState<T> {
  data: T | null
  status: LoadingState
  error: string | null
}

export type Resolution = {
  width: number
  height: number
  label: string  // e.g. "1920×1080"
}

export const STANDARD_RESOLUTIONS: Resolution[] = [
  { width: 3840, height: 2160, label: '3840×2160 (4K)' },
  { width: 2560, height: 1440, label: '2560×1440 (1440p)' },
  { width: 1920, height: 1080, label: '1920×1080 (1080p)' },
  { width: 1280, height: 720,  label: '1280×720 (720p)' },
  { width: 852,  height: 480,  label: '852×480 (480p)' },
]

export type FrameRate = 24 | 25 | 30 | 48 | 50 | 60

export const FRAME_RATES: FrameRate[] = [24, 25, 30, 48, 50, 60]
