import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  formatDuration, formatBytes, formatBitrate, formatDb,
  linearToDb, dbToLinear, faderToDb, dbToFader,
  clamp, generateId, debounce,
} from '../../src/lib/utils'
import { AppError, IpcError, NotFoundError, ValidationError, toErrorMessage } from '../../src/lib/errors'

afterEach(() => {
  vi.useRealTimers()
})

describe('formatDuration', () => {
  it('shows minutes and seconds below an hour', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(65_000)).toBe('01:05')
  })

  it('adds an hours field once past an hour', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
  })

  it('does not round a partial second up', () => {
    expect(formatDuration(1_999)).toBe('00:01')
  })

  it('handles a long recording', () => {
    expect(formatDuration(4 * 3_600_000)).toBe('4:00:00')
  })
})

describe('formatBytes', () => {
  it('uses bytes below a kilobyte', () => {
    expect(formatBytes(512)).toBe('512 B')
  })

  it('switches unit at each boundary', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
    expect(formatBytes(1073741824)).toBe('1.00 GB')
  })

  it('formats a realistic recording size', () => {
    expect(formatBytes(6_596_667)).toBe('6.3 MB')
  })
})

describe('formatBitrate', () => {
  it('reports low rates in bits per second', () => {
    expect(formatBitrate(0)).toBe('0 bps')
    expect(formatBitrate(999)).toBe('999 bps')
  })

  it('reports kilobits without decimals', () => {
    expect(formatBitrate(6000)).toBe('6 Kbps')
  })

  it('reports megabits with two decimals', () => {
    expect(formatBitrate(6_000_000)).toBe('6.00 Mbps')
  })
})

describe('formatDb', () => {
  it('renders silence as negative infinity', () => {
    expect(formatDb(null)).toBe('-∞')
    expect(formatDb(-100)).toBe('-∞')
    expect(formatDb(-120)).toBe('-∞')
  })

  it('renders an audible level to one decimal', () => {
    expect(formatDb(-18)).toBe('-18.0 dB')
    expect(formatDb(0)).toBe('0.0 dB')
  })
})

describe('gain conversions', () => {
  it('maps unity gain to 0 dB', () => {
    expect(linearToDb(1)).toBe(0)
  })

  it('maps half amplitude to about -6 dB', () => {
    expect(linearToDb(0.5)).toBeCloseTo(-6.02, 1)
  })

  it('treats zero amplitude as silence', () => {
    expect(linearToDb(0)).toBe(-Infinity)
  })

  it('round-trips through dB and back', () => {
    for (const v of [0.1, 0.25, 0.5, 0.75, 1]) {
      expect(dbToLinear(linearToDb(v))).toBeCloseTo(v, 6)
    }
  })

  it('floors dbToLinear at the silence threshold', () => {
    expect(dbToLinear(-100)).toBe(0)
    expect(dbToLinear(-200)).toBe(0)
  })
})

describe('fader scaling', () => {
  it('pins the ends of the travel', () => {
    expect(faderToDb(0)).toBe(-Infinity)
    expect(faderToDb(1)).toBe(0)
    expect(dbToFader(0)).toBe(1)
    expect(dbToFader(-100)).toBe(0)
  })

  it('round-trips a mid-travel position', () => {
    for (const pos of [0.25, 0.5, 0.75]) {
      expect(dbToFader(faderToDb(pos))).toBeCloseTo(pos, 6)
    }
  })

  // Cubic scaling gives finer control near unity, as OBS does; a linear
  // mapping would put half travel at -50 dB.
  it('is cubic rather than linear', () => {
    expect(faderToDb(0.5)).toBeGreaterThan(-50)
  })
})

describe('clamp', () => {
  it('passes a value already in range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('clamps to each bound', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })

  it('accepts a value sitting on a bound', () => {
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })
})

describe('generateId', () => {
  it('returns a non-empty string', () => {
    expect(generateId()).toBeTruthy()
  })

  it('does not repeat across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, generateId))
    expect(ids.size).toBe(1000)
  })
})

describe('debounce', () => {
  it('runs once for a burst of calls', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    debounced()
    debounced()
    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not run before the delay elapses', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    debounce(fn, 100)()

    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
  })

  it('passes through the most recent arguments', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('first')
    debounced('second')
    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledWith('second')
  })

  it('runs again after the timer has fired', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    vi.advanceTimersByTime(100)
    debounced()
    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('errors', () => {
  it('carries a code on AppError', () => {
    const err = new AppError('failed', 'E_FAIL')
    expect(err.message).toBe('failed')
    expect(err.code).toBe('E_FAIL')
  })

  it('keeps each error type distinguishable by instanceof', () => {
    expect(new IpcError('x')).toBeInstanceOf(AppError)
    expect(new NotFoundError('x')).toBeInstanceOf(AppError)
    expect(new ValidationError('x')).toBeInstanceOf(AppError)
    expect(new IpcError('x')).not.toBeInstanceOf(NotFoundError)
  })

  it('remains a real Error, so a catch block behaves normally', () => {
    expect(new IpcError('x')).toBeInstanceOf(Error)
  })

  describe('toErrorMessage', () => {
    it('unwraps an Error', () => {
      expect(toErrorMessage(new Error('boom'))).toBe('boom')
    })

    it('passes a string through', () => {
      expect(toErrorMessage('plain failure')).toBe('plain failure')
    })

    it('produces something printable for an unexpected value', () => {
      expect(typeof toErrorMessage({ code: 500 })).toBe('string')
      expect(typeof toErrorMessage(null)).toBe('string')
      expect(typeof toErrorMessage(undefined)).toBe('string')
    })
  })
})
