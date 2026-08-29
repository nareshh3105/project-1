import si from 'systeminformation'
import { command, emit } from '../ipc'
import { STATS_UPDATE_EVENT } from '../output/ffmpeg'

const INTERVAL_MS = 2000

let timer: NodeJS.Timeout | null = null

export function registerStatsCommands() {
  command('start_stats_polling', () => {
    // Guard against a second interval when the renderer reloads; the Rust
    // build used an AtomicBool for the same reason.
    if (timer) return

    const tick = async () => {
      try {
        const [load, mem] = await Promise.all([
          si.currentLoad(),
          si.mem(),
        ])

        emit(STATS_UPDATE_EVENT, {
          cpuPercent: load.currentLoad,
          memoryMb: (mem.active ?? mem.used) / 1024 / 1024,
          gpuPercent: 0,
          renderFps: 30,
          encodeFps: 30,
          skippedFramesRender: 0,
          skippedFramesEncode: 0,
          outputBitrateBps: 0,
          networkBps: 0,
          diskWriteMbps: 0,
        })
      } catch {
        // A failed sample is not worth surfacing; the next tick retries.
      }
    }

    void tick()
    timer = setInterval(tick, INTERVAL_MS)
  })

  command('stop_stats_polling', () => {
    if (timer) clearInterval(timer)
    timer = null
  })
}

export function stopStatsPolling() {
  if (timer) clearInterval(timer)
  timer = null
}
