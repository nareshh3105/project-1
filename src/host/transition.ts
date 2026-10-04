/**
 * How far along a scene transition is, and what that means for drawing.
 *
 * The incoming scene is drawn over the outgoing one:
 *   fade   the incoming scene grows from transparent to opaque,
 *   slide  both scenes move left together, the new one entering from the right,
 *   wipe   the incoming scene is uncovered from the left edge to the right.
 *
 * The preview does the same with CSS animations using the same easing curve, so
 * what is previewed is what is recorded.
 */

export type TransitionType = 'fade' | 'slide' | 'wipe'

/** CSS `ease-in-out`: cubic-bezier(0.42, 0, 0.58, 1). */
const X1 = 0.42
const Y1 = 0
const X2 = 0.58
const Y2 = 1

function bezier(t: number, a: number, b: number): number {
  const u = 1 - t
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t
}

/** Eases a progress of 0..1 the way CSS `ease-in-out` does. */
export function easeInOut(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  const p = Math.min(1, Math.max(0, progress))
  if (p === 0 || p === 1) return p

  // Find the curve parameter whose x is p, then read y there.
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (bezier(mid, X1, X2) < p) lo = mid
    else hi = mid
  }
  return bezier((lo + hi) / 2, Y1, Y2)
}

/**
 * Progress through a transition: 0 as it starts, 1 once it is over. A transition
 * with no length, or a start time in the future (clocks that disagree a little),
 * is treated sensibly rather than dividing by zero or running backwards.
 */
export function transitionProgress(nowMs: number, startedAtMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 1
  const p = (nowMs - startedAtMs) / durationMs
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 1
}

/** How to draw the two scenes at an eased amount `e` (0..1) through a transition. */
export interface TransitionFrame {
  /** Shift of the outgoing scene, in canvas pixels. */
  fromOffsetX: number
  /** Shift of the incoming scene, in canvas pixels. */
  toOffsetX: number
  /** Opacity of the incoming scene. */
  toAlpha: number
  /** Width, from the left edge, of the part of the incoming scene that shows; null for all of it. */
  toRevealWidth: number | null
}

export function transitionFrame(type: TransitionType, e: number, canvasWidth: number): TransitionFrame {
  const k = Math.min(1, Math.max(0, e))
  switch (type) {
    case 'fade':
      return { fromOffsetX: 0, toOffsetX: 0, toAlpha: k, toRevealWidth: null }
    case 'slide':
      return { fromOffsetX: -k * canvasWidth, toOffsetX: (1 - k) * canvasWidth, toAlpha: 1, toRevealWidth: null }
    case 'wipe':
      return { fromOffsetX: 0, toOffsetX: 0, toAlpha: 1, toRevealWidth: k * canvasWidth }
  }
}
