import { ipc } from '@/ipc'
import { resolveTarget, missingMessage, type CaptureTarget, type LiveSource } from './target'

/**
 * Turns a saved capture target into a live stream.
 *
 * Shared by the interface window (for the preview) and the output host (for the
 * recording), which each open their own copy of what a source captures.
 */

/** What the system can capture right now for a kind of target. */
export async function liveSources(target: CaptureTarget): Promise<LiveSource[]> {
  if (target.kind === 'camera') {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ id: d.deviceId, name: d.label || `Camera ${i + 1}` }))
  }
  const sources = await ipc.capture.listSources([target.kind])
  return sources.map((s) => ({ id: s.id, name: s.name }))
}

export async function openCaptureStream(target: CaptureTarget): Promise<MediaStream> {
  const live = resolveTarget(target, await liveSources(target))
  if (!live) throw new Error(missingMessage(target))

  if (target.kind === 'camera') {
    return navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: live.id } },
      audio: false,
    })
  }

  // Electron grants a screen capture only to a choice made through the broker
  // just beforehand, so say what is wanted and then ask for it.
  await ipc.capture.prepare(live.id, false)
  return navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 } as MediaTrackConstraints,
    audio: false,
  })
}
