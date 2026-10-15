import { describe, it, expect, vi } from 'vitest'
import os from 'node:os'
import { raiseOutputPriority } from '../../electron/main/host/window'

/**
 * While an output runs, the engine that builds and encodes each frame is given
 * priority over the rest of the app. With the interface window visible and at the
 * same priority, frames arrived late often enough to show as stutter in a stream
 * (measured: 33 to 79 late frames in 40 seconds; none once raised).
 */

describe('raiseOutputPriority', () => {
  it('asks for high priority, the most an ordinary program may have', () => {
    const set = vi.fn()
    raiseOutputPriority([100], set)
    expect(set).toHaveBeenCalledWith(100, os.constants.priority.PRIORITY_HIGH)
  })

  it('raises each process once, even if named twice', () => {
    const set = vi.fn()
    expect(raiseOutputPriority([100, 200, 100], set)).toBe(2)
    expect(set).toHaveBeenCalledTimes(2)
  })

  it.each([[0], [-4], [1.5], [NaN]])('ignores the process id %s', (pid) => {
    const set = vi.fn()
    expect(raiseOutputPriority([pid], set)).toBe(0)
    expect(set).not.toHaveBeenCalled()
  })

  it('carries on when the system refuses one, and counts what it did raise', () => {
    const set = vi.fn((pid: number) => { if (pid === 100) throw new Error('access denied') })
    expect(raiseOutputPriority([100, 200], set)).toBe(1)
    expect(set).toHaveBeenCalledTimes(2)
  })

  it('does nothing for no processes', () => {
    const set = vi.fn()
    expect(raiseOutputPriority([], set)).toBe(0)
    expect(set).not.toHaveBeenCalled()
  })
})
