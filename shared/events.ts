/**
 * IPC event names, shared by the main and renderer processes.
 *
 * These lived in three places — main-process constants, a renderer table in
 * lib/constants.ts, and string literals in the ipc layer — and drifted apart.
 * A stream that was live showed no Stop button because one side said
 * 'output:streaming-status' and the other 'output:stream-status'. Both
 * processes now import this module, so a rename cannot desynchronise them.
 *
 * Keep it dependency-free: the main process compiles without DOM types and
 * the renderer compiles without Node types.
 */
export const IPC_EVENTS = {
  RECORDING_STATUS: 'output:recording-status',
  /** An output ended on its own: FFmpeg died, or the host's encoder failed. */
  OUTPUT_ERROR:     'output:error',
  STREAM_STATUS:    'output:stream-status',
  REPLAY_STATUS:    'output:replay-status',
  VCAM_STATUS:      'output:virtual-camera-status',
  STATS_UPDATE:     'stats:update',
  HOTKEY_PRESSED:   'hotkey:pressed',
  UPDATER_PROGRESS: 'updater:download-progress',
} as const

export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]
