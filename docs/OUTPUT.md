# How recording and streaming work

Recording, streaming, the replay buffer and the virtual camera are all fed by one
engine: the **output host**. This note says what it is, why it is built that way,
and how to check it still works.

## The pieces

```
interface window ──(scene + mixer state)──▶ main process ──▶ output host window
  preview, panels                              commands,                │
                                               FFmpeg                   │  captures the screen/window/camera
                                                  ▲                     │  composes the scene on a canvas
                                                  │  fragmented MP4     │  mixes the audio
                                                  └──── stdin ◀─────────┘  encodes (WebCodecs H.264 + Opus)
```

- The **interface window** is what the user sees. It publishes the scene (which
  sources, where, in what order) and the mixer (volumes, mutes, which inputs are
  connected) to the main process whenever they change.
- The **output host** (`host.html`, code in `src/host/`) is a second, invisible
  window. When an output starts it opens its own copies of the captures and audio
  inputs, draws the scene at the output's frame rate, mixes the audio, and encodes
  both. Nothing is captured while no output is running.
- The **main process** starts FFmpeg waiting on its standard input, asks the host
  to start, and passes the host's bytes to FFmpeg. FFmpeg does not encode: it only
  puts the stream into a file (`-c:v copy`), an RTMP stream, replay segments or a
  UDP stream. Stopping closes FFmpeg's input, which is how it finishes a file.

## Why a separate window

Measured in `docs/spikes/output-pipeline.md`:

- Web Audio runs at about 72% of real time in a window that is minimized, so a
  recording made from the main window would lose sound whenever it was minimized.
  The host is a window of its own, shown but parked far off-screen, where the
  audio clock keeps real time.
- `MediaRecorder` drops 20–30% of frames at the start of a recording and cannot be
  controlled. Frames and audio are therefore stamped by the host itself from one
  clock and encoded with WebCodecs.
- An audio context tied to the speakers runs at the speed of the speakers' clock
  and was measured at 93% of real time. The host's audio runs without an output
  device (`sinkId: { type: 'none' }`) and measures 99–100%.

## Timing

- Video frames are stamped with `performance.now()` when they are composed.
- Audio comes from an `AudioWorklet` that reports the exact position of each
  block on the audio clock. `AudioClockMap` relates that to the wall clock, and
  `AudioTimeline` lays the blocks end to end, filling a gap with silence or
  trimming an overlap only when the audio strays more than 20 ms.

## Checking it

`scripts/e2e/record.cjs` launches the **built** app with a fresh profile, drives it
over the DevTools protocol, records with the window minimized, and measures the
file.

```
npx electron-vite build
node scripts/e2e/record.cjs 60 --sync                 # frame rate, stalls, audio/picture offset, drift
node scripts/e2e/record.cjs 30 --kind=streaming       # to a local RTMP receiver
node scripts/e2e/record.cjs 40 --kind=replay          # fill the buffer, save, measure
node scripts/e2e/record.cjs 15 --kind=vcam
node scripts/e2e/record.cjs 25 --sync --arrange       # source shrunk to the middle: corners must stay black
```

`--sync` puts a full-screen flash-and-beep signal on screen, so it flashes and
plays sound on your machine while it runs. It records your real screen; the
recording is measured and then deleted (pass `--keep` to keep it).

Measured on an i5-1135G7 laptop, 1080p30 with system audio, 4 minutes: 30.0 fps,
0 frames dropped, memory flat at 1.5 GB for the whole app, audio clock 99.6–100.1%
of real time, 119 ms of silence inserted in total. 1080p60 reaches 59.4 fps with
dropped frames and a slower audio clock; that is the current limit.
