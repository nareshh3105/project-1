import { AudioClockMap } from './audioClock'
import { Mixer } from './mixer'
import { SAMPLE_RATE } from './session'
import type { AudioBlock, AudioRig } from './hostApp'
import { requestDesktopAudio, requestMicrophone } from '@/lib/audio/engine'
import workletUrl from './capture-worklet.js?url'

/**
 * The real Web Audio graph behind the output host.
 *
 *   inputs -> per-channel gain -> worklet -> (silent) sink -> speakers
 *
 * The worklet reports each block of samples with the exact position of its first
 * sample on the audio clock; the clock map relates that to the wall clock the
 * video is stamped from. The sink exists only to make the browser pull the graph.
 */

const BLOCK_MS = (1024 / SAMPLE_RATE) * 1000

export async function createAudioRig(onBlock: (block: AudioBlock) => void): Promise<AudioRig> {
  // No output device. A context tied to the speakers runs at the speed of the
  // speakers' clock and glitches with them: measured at 93% of real time, which
  // meant about 7% of the audio was lost. Without a device the context renders
  // on a timer and measures 99.8%. Nothing needs to be audible here anyway.
  const context = new AudioContext({
    sampleRate: SAMPLE_RATE, latencyHint: 'balanced', sinkId: { type: 'none' },
  } as AudioContextOptions)
  if (context.state === 'suspended') await context.resume()

  await context.audioWorklet.addModule(workletUrl)
  const worklet = new AudioWorkletNode(context, 'capture', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
  })
  const sink = context.createGain()
  sink.gain.value = 0
  worklet.connect(sink)
  sink.connect(context.destination)

  // Read both clocks together to relate them; a pair is only as good as the gap
  // between its two reads, so take several and keep the tightest.
  let best: { width: number; perf: number; ctx: number } | null = null
  for (let i = 0; i < 8; i++) {
    const p0 = performance.now()
    const c = context.currentTime
    const p1 = performance.now()
    if (!best || p1 - p0 < best.width) best = { width: p1 - p0, perf: (p0 + p1) / 2, ctx: c }
  }
  const clock = new AudioClockMap({ anchor: { ctxSec: best!.ctx, perfMs: best!.perf } })

  worklet.port.onmessage = (e: MessageEvent<{ startFrame: number; frames: number; data: ArrayBuffer }>) => {
    const { startFrame, frames, data } = e.data
    const startSec = startFrame / SAMPLE_RATE
    clock.observe(startSec, (frames / SAMPLE_RATE) * 1000 || BLOCK_MS, performance.now())
    onBlock({ startSec, frames, data: new Float32Array(data) })
  }

  const mixer = new Mixer(
    {
      openInput: async (id, deviceId) => {
        if (id === 'desktop') return requestDesktopAudio()
        if (!deviceId) return requestMicrophone()
        // A recording that silently loses the microphone is worse than one that
        // uses the default, so a device that has gone falls back to the default.
        try { return await requestMicrophone(deviceId) } catch { return requestMicrophone() }
      },
      createGain: () => context.createGain(),
      createSource: (stream) => context.createMediaStreamSource(stream),
    },
    worklet,
  )

  return {
    apply: (channels) => mixer.apply(channels),
    toWallMs: (ctxSec) => clock.toPerfMs(ctxSec),
    debug: () => ({ state: context.state, ctxSec: context.currentTime, perfMs: performance.now(), sinkId: String((context as unknown as { sinkId?: unknown }).sinkId ?? '') }),
    dispose: () => {
      mixer.dispose()
      worklet.port.onmessage = null
      try { worklet.disconnect() } catch { /* already disconnected */ }
      void context.close().catch(() => {})
    },
  }
}
