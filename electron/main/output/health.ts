import type { OutputKind } from '../../../shared/host'

/**
 * How well each running output is keeping up, worked out from the counts the
 * output host reports every couple of seconds.
 *
 * The status bar used to show a frame rate of 30 and no dropped frames whatever
 * was happening. These are measured: frames delivered per second between two
 * reports, frames the encoder could not take, and bytes produced.
 */

export interface HealthSample {
  /** When the host took the reading, in milliseconds. */
  at: number
  framesIn: number
  framesDropped: number
  bytesOut: number
}

export interface OutputMetrics {
  kind: OutputKind
  /** Frames per second that actually reached the encoder over the last interval. */
  fps: number
  /** Bits per second produced over the last interval. */
  bitrateBps: number
  /** Frames dropped since the output started. */
  framesDropped: number
  /** Share of the last interval's frames that were dropped, 0 to 1. */
  recentDropRatio: number
  struggling: boolean
}

/** More than this share of frames dropped counts as not keeping up. */
export const STRUGGLE_RATIO = 0.05
/** Consecutive bad readings before it is called, and good ones before it is called off. */
const BAD_NEEDED = 2
const GOOD_NEEDED = 3

interface State {
  last: HealthSample
  metrics: OutputMetrics
  bad: number
  good: number
}

export class OutputHealth {
  private readonly states = new Map<OutputKind, State>()

  /**
   * Takes a reading. Returns the new state of "keeping up" if it changed with
   * this reading (true means it has started struggling), otherwise null.
   */
  record(kind: OutputKind, sample: HealthSample): boolean | null {
    const prev = this.states.get(kind)
    if (!prev) {
      this.states.set(kind, {
        last: sample, bad: 0, good: 0,
        metrics: { kind, fps: 0, bitrateBps: 0, framesDropped: sample.framesDropped, recentDropRatio: 0, struggling: false },
      })
      return null
    }

    const seconds = (sample.at - prev.last.at) / 1000
    if (!(seconds > 0)) return null // a repeated or out-of-order reading says nothing

    const arrived = Math.max(0, sample.framesIn - prev.last.framesIn)
    const dropped = Math.max(0, sample.framesDropped - prev.last.framesDropped)
    const ratio = arrived > 0 ? dropped / arrived : 0

    prev.metrics = {
      kind,
      fps: (arrived - dropped) / seconds,
      bitrateBps: (Math.max(0, sample.bytesOut - prev.last.bytesOut) * 8) / seconds,
      framesDropped: sample.framesDropped,
      recentDropRatio: ratio,
      struggling: prev.metrics.struggling,
    }
    prev.last = sample

    if (ratio > STRUGGLE_RATIO) { prev.bad++; prev.good = 0 } else { prev.good++; prev.bad = 0 }

    if (!prev.metrics.struggling && prev.bad >= BAD_NEEDED) { prev.metrics.struggling = true; return true }
    if (prev.metrics.struggling && prev.good >= GOOD_NEEDED) { prev.metrics.struggling = false; return false }
    return null
  }

  /** Forget an output that has ended. */
  reset(kind: OutputKind): void {
    this.states.delete(kind)
  }

  metrics(): OutputMetrics[] {
    return [...this.states.values()].map((s) => s.metrics)
  }

  /** What the status bar shows: the most important running output's rate, and the totals. */
  summary(): { fps: number; bitrateBps: number; framesDropped: number; active: boolean } {
    const all = this.metrics()
    if (all.length === 0) return { fps: 0, bitrateBps: 0, framesDropped: 0, active: false }

    const order: OutputKind[] = ['recording', 'streaming', 'replay', 'virtualCamera']
    const lead = [...all].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0]
    return {
      fps: lead.fps,
      bitrateBps: all.reduce((sum, m) => sum + m.bitrateBps, 0),
      framesDropped: all.reduce((sum, m) => sum + m.framesDropped, 0),
      active: true,
    }
  }
}
