import { DirectMixer, type InputHandle } from './directMixer'
import { Mixer } from './mixer'
import type { AudioBlock, AudioRig } from './hostApp'
import type { RawChunk } from './audioInput'
import { requestDesktopAudio, requestMicrophone } from '@/lib/audio/engine'

/**
 * The audio side of the output host, bound to the browser.
 *
 *   input (microphone / system audio)
 *     -> MediaStreamTrackProcessor: the captured chunks, with capture times
 *     -> DirectMixer: sums them into one mix on the capture clock
 *     -> blocks handed to the encoder
 *
 * There is deliberately no Web Audio context here. Its clock runs at the pace of
 * a render thread that falls behind under video load (measured at 95% of real
 * time at 1080p60, which lost about 5% of the sound); the capture devices keep
 * time exactly (measured 99.96%).
 */

/** How often the mixer is asked whether a block is ready. Well under the block length of 21 ms. */
const PUMP_EVERY_MS = 10

export async function createAudioRig(onBlock: (block: AudioBlock) => void): Promise<AudioRig> {
  const mixer = new DirectMixer({
    now: () => performance.now(),
    onBlock: (b) => onBlock({ startSec: b.startSec, frames: b.frames, data: b.data }),
  })
  const timer = setInterval(() => mixer.pump(), PUMP_EVERY_MS)

  const inputs = new Mixer({
    openInput: async (id, deviceId) => {
      if (id === 'desktop') return requestDesktopAudio()
      if (!deviceId) return requestMicrophone()
      // A recording that silently loses the microphone is worse than one that
      // uses the default, so a device that has gone falls back to the default.
      try { return await requestMicrophone(deviceId) } catch { return requestMicrophone() }
    },
    attach: (id, stream) => readInto(mixer.addInput(id), stream),
  })

  return {
    apply: (channels) => inputs.apply(channels),
    toWallMs: (captureSec) => mixer.toWallMs(captureSec),
    debug: () => ({ state: 'direct', ...mixer.debug() }),
    dispose: () => {
      clearInterval(timer)
      inputs.dispose()
    },
  }
}

/** Reads a stream's audio, chunk by chunk, into the mix until it is detached or ends. */
function readInto(handle: InputHandle, stream: MediaStream) {
  const track = stream.getAudioTracks()[0]
  let stopped = false
  let reader: ReadableStreamDefaultReader<AudioData> | null = null

  if (track) {
    const processor = new MediaStreamTrackProcessor({ track })
    reader = processor.readable.getReader() as ReadableStreamDefaultReader<AudioData>

    void (async () => {
      try {
        while (!stopped && reader) {
          const { value, done } = await reader.read()
          if (done || !value) break
          const arrival = performance.now()
          try {
            handle.push(toChunk(value), arrival)
          } finally {
            value.close()
          }
        }
      } catch {
        // The track ended or the stream was cancelled; the mixer is told by the track's own event.
      }
    })()
  }

  return {
    setGain: (gain: number) => handle.setGain(gain),
    detach: () => {
      stopped = true
      void reader?.cancel().catch(() => {})
      handle.remove()
    },
  }
}

/** One AudioData as planar float32, one array per channel, whatever format it arrived in. */
function toChunk(data: AudioData): RawChunk {
  const channels: Float32Array[] = []
  for (let c = 0; c < Math.min(data.numberOfChannels, 2); c++) {
    const plane = new Float32Array(data.numberOfFrames)
    data.copyTo(plane, { planeIndex: c, format: 'f32-planar' })
    channels.push(plane)
  }
  return { timestampUs: data.timestamp, sampleRate: data.sampleRate, channels }
}
