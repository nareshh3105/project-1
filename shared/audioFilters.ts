/**
 * Audio filters for an input: gain, a noise gate and a compressor, in that
 * order, the way OBS orders them.
 *
 * Shared by the interface (which edits and stores them), the main process
 * (which checks them on the way to the output host) and the host (which runs
 * them on the sound that is recorded and streamed). Dependency-free.
 */

export interface GateSettings {
  enabled: boolean
  /** Opens above this level. dBFS. */
  openDb: number
  /** Closes below this level; below openDb, so the gate does not chatter. dBFS. */
  closeDb: number
  /** How long it stays open after the level falls, in ms. */
  holdMs: number
}

export interface CompressorSettings {
  enabled: boolean
  /** Level above which it reduces. dBFS. */
  thresholdDb: number
  /** How much a level over the threshold is reduced: 4 means 4 dB over becomes 1 dB over. */
  ratio: number
  attackMs: number
  releaseMs: number
  /** Gain added after compressing, to bring the level back up. dB. */
  makeupDb: number
}

export interface AudioFilters {
  /** Gain before anything else, dB. 0 changes nothing. */
  gainDb: number
  gate: GateSettings
  compressor: CompressorSettings
}

export const DEFAULT_FILTERS: AudioFilters = {
  gainDb: 0,
  gate: { enabled: false, openDb: -26, closeDb: -32, holdMs: 200 },
  compressor: { enabled: false, thresholdDb: -18, ratio: 4, attackMs: 6, releaseMs: 60, makeupDb: 0 },
}

export const LIMITS = {
  gainDb: [-30, 30],
  gateDb: [-96, 0],
  holdMs: [0, 2000],
  thresholdDb: [-60, 0],
  ratio: [1, 32],
  attackMs: [0.1, 500],
  releaseMs: [1, 2000],
  makeupDb: [0, 30],
} as const

const num = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {})

/** Reads filters from anywhere (storage, another process), clamping each value and defaulting what is missing. */
export function parseFilters(raw: unknown): AudioFilters {
  const r = obj(raw)
  const g = obj(r.gate)
  const c = obj(r.compressor)
  const d = DEFAULT_FILTERS

  const openDb = num(g.openDb, LIMITS.gateDb, d.gate.openDb)
  return {
    gainDb: num(r.gainDb, LIMITS.gainDb, d.gainDb),
    gate: {
      enabled: g.enabled === true,
      openDb,
      // Never above the opening level: that would leave the gate unable to stay open.
      closeDb: Math.min(openDb, num(g.closeDb, LIMITS.gateDb, d.gate.closeDb)),
      holdMs: num(g.holdMs, LIMITS.holdMs, d.gate.holdMs),
    },
    compressor: {
      enabled: c.enabled === true,
      thresholdDb: num(c.thresholdDb, LIMITS.thresholdDb, d.compressor.thresholdDb),
      ratio: num(c.ratio, LIMITS.ratio, d.compressor.ratio),
      attackMs: num(c.attackMs, LIMITS.attackMs, d.compressor.attackMs),
      releaseMs: num(c.releaseMs, LIMITS.releaseMs, d.compressor.releaseMs),
      makeupDb: num(c.makeupDb, LIMITS.makeupDb, d.compressor.makeupDb),
    },
  }
}

/** Whether these filters would change the sound at all. */
export const isActive = (f: AudioFilters): boolean => f.gainDb !== 0 || f.gate.enabled || f.compressor.enabled

const dbToGain = (db: number) => Math.pow(10, db / 20)
const gainToDb = (g: number) => (g > 1e-9 ? 20 * Math.log10(g) : -180)
/** Per-sample smoothing factor for a time constant. */
const coef = (ms: number, rate: number) => (ms <= 0 ? 0 : Math.exp(-1 / ((ms / 1000) * rate)))

/** How fast the gate fades in and out, so it does not click. */
const GATE_OPEN_MS = 5
const GATE_CLOSE_MS = 120
/** How fast the level the gate follows rises and falls. */
const DETECT_ATTACK_MS = 1
const DETECT_RELEASE_MS = 50

/**
 * Runs the filters over stereo sound, block after block, keeping what it needs
 * between blocks (where the gate is, how much the compressor is reducing) so the
 * sound has no seams. Left and right are treated together, so the picture of the
 * sound does not shift from side to side.
 */
export class FilterChain {
  private filters: AudioFilters = DEFAULT_FILTERS
  private level = 0          // followed level, linear
  private gateGain = 1       // 0 closed, 1 open
  private gateOpen = true
  private holdLeft = 0       // samples
  private compDb = 0         // current reduction, dB (0 or negative)

  constructor(private readonly rate = 48000) {}

  set(filters: AudioFilters): void {
    // A gate just switched on starts closed: it should not let the first moment of noise through.
    if (filters.gate.enabled && !this.filters.gate.enabled) { this.gateOpen = false; this.gateGain = 0; this.holdLeft = 0 }
    if (!filters.compressor.enabled) this.compDb = 0
    this.filters = filters
  }

  get current(): AudioFilters {
    return this.filters
  }

  /** Changes the sound in place. */
  process(left: Float32Array, right: Float32Array): void {
    const f = this.filters
    if (!isActive(f)) return

    const gain = dbToGain(f.gainDb)
    const n = Math.min(left.length, right.length)

    const dAtk = coef(DETECT_ATTACK_MS, this.rate)
    const dRel = coef(DETECT_RELEASE_MS, this.rate)
    const gOpen = coef(GATE_OPEN_MS, this.rate)
    const gClose = coef(GATE_CLOSE_MS, this.rate)
    const openAt = dbToGain(f.gate.openDb)
    const closeAt = dbToGain(f.gate.closeDb)
    const hold = Math.round((f.gate.holdMs / 1000) * this.rate)

    const c = f.compressor
    const cAtk = coef(c.attackMs, this.rate)
    const cRel = coef(c.releaseMs, this.rate)
    const slope = 1 - 1 / c.ratio
    const makeup = dbToGain(c.makeupDb)

    for (let i = 0; i < n; i++) {
      let l = left[i] * gain
      let r = right[i] * gain

      const peak = Math.max(Math.abs(l), Math.abs(r))
      this.level = peak > this.level ? dAtk * this.level + (1 - dAtk) * peak : dRel * this.level + (1 - dRel) * peak

      if (f.gate.enabled) {
        if (this.level >= openAt) { this.gateOpen = true; this.holdLeft = hold }
        else if (this.level < closeAt) {
          if (this.holdLeft > 0) this.holdLeft--
          else this.gateOpen = false
        }
        const target = this.gateOpen ? 1 : 0
        const k = target > this.gateGain ? gOpen : gClose
        this.gateGain = k * this.gateGain + (1 - k) * target
        l *= this.gateGain
        r *= this.gateGain
      }

      if (c.enabled) {
        const over = gainToDb(this.level * (f.gate.enabled ? this.gateGain : 1)) - c.thresholdDb
        const wanted = over > 0 ? -over * slope : 0
        const k = wanted < this.compDb ? cAtk : cRel
        this.compDb = k * this.compDb + (1 - k) * wanted
        const g = dbToGain(this.compDb) * makeup
        l *= g
        r *= g
      }

      left[i] = l
      right[i] = r
    }
  }
}
