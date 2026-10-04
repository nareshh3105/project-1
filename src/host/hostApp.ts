import {
  HOST_CHANNELS, EMPTY_SNAPSHOT,
  type HostEvent, type HostRequest, type HostResponse, type HostSnapshot, type OutputKind, type SessionParams,
} from '../../shared/host'
import { CapturePool, type PoolDeps } from './capturePool'
import { drawFrame, type ReadyLayer } from './compositor'
import { planFilters, croppedArea, type FilterPlan } from '@/lib/filters/plan'
import { outputMapping } from './geometry'
import { easeInOut, transitionFrame, transitionProgress } from './transition'
import { FrameLoop, type LoopDeps } from './frameLoop'
import { StaticLayers, type StaticDeps } from './staticLayers'
import { EncoderSession, type SessionDeps } from './session'
import type { SnapshotChannel, SnapshotSource } from '../../shared/host'

/**
 * The output host: composes the scene, mixes the audio and encodes the result
 * for each running output, on request from the main process.
 *
 * It owns its own captures and its own audio inputs, opened only while an
 * output is running, so that an idle app holds no screen capture and no
 * microphone.
 */

export interface Bridge {
  send(channel: string, ...args: unknown[]): void
  listen(channel: string, callback: (...args: unknown[]) => void): () => void
}

/** The audio side: the mix, and a way to read it as blocks of samples. */
export interface AudioRig {
  apply(channels: readonly SnapshotChannel[]): void
  dispose(): void
  /** Maps a position on the audio clock to wall-clock ms. */
  toWallMs(ctxSec: number): number
  /** Where the audio clock is, for checking that it keeps up with real time. */
  debug?(): { state: string; ctxSec: number; perfMs: number; sinkId: string }
}

export interface AudioBlock {
  /** Audio-clock position of the first sample, in seconds. */
  startSec: number
  frames: number
  /** Planar float32: left, then right. */
  data: Float32Array
}

export interface HostDeps {
  bridge: Bridge
  session: SessionDeps
  pool: PoolDeps
  statics: StaticDeps
  /** Puts the SVG filters the sources refer to into the page, replacing the last set. */
  setFilterDefs(markup: string): void
  loop: LoopDeps
  now(): number
  /** Milliseconds since the epoch, the clock a transition's start time is on. */
  wallNow(): number
  createCanvas(width: number, height: number): { canvas: unknown; context: CanvasRenderingContext2D }
  /** Starts the audio rig; `onBlock` receives the mix as it is produced. */
  createAudio(onBlock: (block: AudioBlock) => void): Promise<AudioRig>
}

interface Running {
  kind: OutputKind
  params: SessionParams
  session: EncoderSession
  canvas: unknown
  context: CanvasRenderingContext2D
  statsTimer: ReturnType<typeof setInterval>
}

const STATS_EVERY_MS = 5000

export class HostApp {
  private readonly running = new Map<OutputKind, Running>()
  private readonly opening = new Set<OutputKind>()
  private readonly pool: CapturePool
  private readonly statics: StaticLayers
  private readonly loop: FrameLoop
  private snapshot: HostSnapshot = EMPTY_SNAPSHOT
  private audio: AudioRig | null = null
  private defsInPage = ''
  /** Filter plans already worked out, so a frame does not rebuild strings 30 times a second. */
  private readonly plans = new Map<string, { key: string; plan: FilterPlan }>()
  private audioStarting: Promise<AudioRig> | null = null
  private unlisten: Array<() => void> = []

  constructor(private readonly deps: HostDeps) {
    this.pool = new CapturePool(deps.pool)
    this.statics = new StaticLayers(deps.statics)
    this.loop = new FrameLoop(deps.loop)
    this.loop.onError = (id, err) => this.report(id as OutputKind, `drawing failed: ${messageOf(err)}`)
  }

  /** Starts listening and tells the main process the page is ready. */
  start(): void {
    const { bridge } = this.deps
    this.unlisten.push(
      bridge.listen(HOST_CHANNELS.request, (request) => void this.handle(request as HostRequest)),
      bridge.listen(HOST_CHANNELS.state, (snapshot) => this.setSnapshot(snapshot as HostSnapshot)),
    )
    bridge.send(HOST_CHANNELS.ready)
  }

  dispose(): void {
    this.unlisten.forEach((u) => u())
    this.unlisten = []
    for (const kind of [...this.running.keys()]) this.abort(kind)
    this.releaseIdle()
  }

  /** Diagnostics, readable from the host page's console. */
  debug() {
    return {
      active: this.active,
      captures: this.pool.debug(),
      audio: this.audio?.debug?.() ?? null,
      snapshot: this.snapshot,
      sessions: [...this.running.values()].map((r) => ({ kind: r.kind, ...r.session.stats() })),
    }
  }

  get active(): OutputKind[] {
    return [...this.running.keys()]
  }

  // ── requests ──

  private async handle(request: HostRequest): Promise<void> {
    const reply = (response: Omit<HostResponse, 'id'>) =>
      this.deps.bridge.send(HOST_CHANNELS.response, { id: request.id, ...response })

    try {
      const args = (request.args ?? {}) as { kind?: OutputKind; params?: SessionParams }
      switch (request.method) {
        case 'ping':
          reply({ ok: true, result: 'pong' })
          return
        case 'openSession':
          await this.open(args.kind as OutputKind, args.params as SessionParams)
          reply({ ok: true })
          return
        case 'closeSession':
          await this.close(args.kind as OutputKind)
          reply({ ok: true })
          return
        default:
          reply({ ok: false, error: `Unknown request: ${String(request.method)}` })
      }
    } catch (err) {
      reply({ ok: false, error: messageOf(err) })
    }
  }

  async open(kind: OutputKind, params: SessionParams): Promise<void> {
    if (!kind || !params) throw new Error('Missing output details.')
    if (this.running.has(kind) || this.opening.has(kind)) throw new Error(`The ${kind} output is already running.`)

    this.opening.add(kind)
    try {
      if (params.audio) await this.ensureAudio()

      const session = await EncoderSession.create(
        params,
        (data) => this.deps.bridge.send(HOST_CHANNELS.ingest, kind, data),
        this.deps.session,
      )
      const { canvas, context } = this.deps.createCanvas(params.width, params.height)

      const entry: Running = {
        kind, params, session, canvas, context,
        statsTimer: setInterval(() => this.sendStats(entry), STATS_EVERY_MS),
      }
      session.onError = (message) => this.report(kind, message)
      this.running.set(kind, entry)

      // Bring captures and audio up to date for the scene being output.
      this.pool.sync(involved(this.snapshot))
      this.syncFilterDefs(this.snapshot)
      this.audio?.apply(this.snapshot.audio)

      session.start(this.deps.now())
      this.loop.add(kind, params.fps, (now) => this.compose(entry, now))
      this.loop.start()
    } catch (err) {
      this.releaseIdle()
      throw err
    } finally {
      this.opening.delete(kind)
    }
  }

  async close(kind: OutputKind): Promise<void> {
    const entry = this.running.get(kind)
    if (!entry) return

    // Stop drawing first so the encoder sees no more frames while it flushes.
    this.loop.remove(kind)
    clearInterval(entry.statsTimer)
    this.running.delete(kind)

    try {
      await entry.session.stop()
    } finally {
      this.releaseIdle()
    }
  }

  // ── scene state ──

  private setSnapshot(snapshot: HostSnapshot): void {
    this.snapshot = snapshot
    if (this.running.size === 0) return
    this.pool.sync(involved(snapshot))
    this.statics.prune(involved(snapshot))
    this.syncFilterDefs(snapshot)
    this.audio?.apply(snapshot.audio)
  }

  /** Sharpen and chroma key are SVG filters; they have to be in the page before a frame refers to them. */
  private syncFilterDefs(snapshot: HostSnapshot): void {
    const all = involved(snapshot)
    const keep = new Set(all.map((s) => s.id))
    for (const id of [...this.plans.keys()]) if (!keep.has(id)) this.plans.delete(id)

    const markup = all.map((s) => planFilters(s.filters, 1).defs).join('')
    if (markup !== this.defsInPage) {
      this.defsInPage = markup
      this.deps.setFilterDefs(markup)
    }
  }

  private compose(entry: Running, nowMs: number): void {
    const { sources, base, transition } = this.snapshot
    const out = { width: entry.params.width, height: entry.params.height }
    const scale = outputMapping(base, out).scale

    const progress = transition ? transitionProgress(this.deps.wallNow(), transition.startedAt, transition.durationMs) : 1
    if (transition && progress < 1) {
      // The incoming scene goes over the outgoing one, which stays drawn underneath.
      const f = transitionFrame(transition.type, easeInOut(progress), base.width)
      drawFrame(entry.context, out, base, this.layersFor(transition.from, scale), { offsetX: f.fromOffsetX })
      drawFrame(entry.context, out, base, this.layersFor(sources, scale), {
        clear: false, alpha: f.toAlpha, offsetX: f.toOffsetX, revealWidth: f.toRevealWidth,
      })
    } else {
      drawFrame(entry.context, out, base, this.layersFor(sources, scale))
    }
    entry.session.submitFrame(entry.canvas, nowMs)
  }

  /** The pictures of a scene's sources that are ready to draw, bottom first. */
  private layersFor(sources: readonly SnapshotSource[], scale: number): ReadyLayer[] {
    const layers: ReadyLayer[] = []
    for (const source of [...sources].sort((a, b) => a.order - b.order)) {
      const frame = this.pool.frameFor(source.id) ?? this.statics.frameFor(source)
      if (!frame) continue

      const plan = this.planFor(source, scale)
      const area = croppedArea(frame.width, frame.height, plan.crop)
      layers.push({
        transform: source.transform,
        image: frame.image as unknown as CanvasImageSource,
        width: area ? area.sw : frame.width,
        height: area ? area.sh : frame.height,
        crop: area && (plan.crop.left || plan.crop.right || plan.crop.top || plan.crop.bottom) ? area : undefined,
        filter: plan.css,
      })
    }
    return layers
  }

  /** The drawing plan for a source's filters, remembered until they change. */
  private planFor(source: SnapshotSource, scale: number): FilterPlan {
    if (source.filters.length === 0) return planFilters([], scale)

    const key = `${scale}|${JSON.stringify(source.filters)}`
    const known = this.plans.get(source.id)
    if (known?.key === key) return known.plan

    const plan = planFilters(source.filters, scale)
    this.plans.set(source.id, { key, plan })
    return plan
  }

  // ── audio ──

  private async ensureAudio(): Promise<AudioRig> {
    if (this.audio) return this.audio
    this.audioStarting ??= this.deps.createAudio((block) => this.fanOut(block))
    try {
      this.audio = await this.audioStarting
      return this.audio
    } finally {
      this.audioStarting = null
    }
  }

  private fanOut(block: AudioBlock): void {
    if (!this.audio) return
    const wallMs = this.audio.toWallMs(block.startSec)
    for (const { session, params } of this.running.values()) {
      if (params.audio) session.submitAudio(wallMs, block.frames, block.data)
    }
  }

  // ── housekeeping ──

  /** Lets go of captures and inputs once no output needs them. */
  private releaseIdle(): void {
    if (this.running.size > 0 || this.opening.size > 1) return
    this.loop.stop()
    this.pool.stopAll()
    this.statics.clear()
    this.audio?.dispose()
    this.audio = null
  }

  private abort(kind: OutputKind): void {
    const entry = this.running.get(kind)
    if (!entry) return
    this.loop.remove(kind)
    clearInterval(entry.statsTimer)
    entry.session.abort()
    this.running.delete(kind)
  }

  private report(kind: OutputKind, message: string): void {
    // A failed encoder cannot be recovered; end it so the main process can say so.
    this.abort(kind)
    this.releaseIdle()
    this.emit({ type: 'sessionError', kind, message })
  }

  private sendStats(entry: Running): void {
    const s = entry.session.stats()
    this.emit({ type: 'stats', kind: entry.kind, framesIn: s.framesIn, framesDropped: s.framesDropped, encodeQueue: s.encodeQueue })
  }

  private emit(event: HostEvent): void {
    this.deps.bridge.send(HOST_CHANNELS.event, event)
  }
}

/** Every source that needs a picture now: the scene, and the one it is replacing during a transition. */
function involved(snapshot: HostSnapshot): SnapshotSource[] {
  return snapshot.transition ? [...snapshot.sources, ...snapshot.transition.from] : snapshot.sources
}

const messageOf = (err: unknown) => (err instanceof Error && err.message ? err.message : 'Something went wrong.')
