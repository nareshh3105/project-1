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
  sources, where, in what order, with which filters), any transition in progress,
  and the mixer (volumes, mutes, which inputs are connected, which microphone) to the
  main process whenever they change.
- The **output host** (`host.html`, code in `src/host/`) is a second, invisible
  window. When an output starts it opens its own copies of the captures and audio
  inputs, draws the scene at the output's frame rate, mixes the audio, and encodes
  both. Nothing is captured while no output is running.
- The **main process** starts FFmpeg waiting on its standard input, asks the host
  to start, and passes the host's bytes to FFmpeg. FFmpeg does not encode: it only
  puts the stream into a file (`-c:v copy`), an RTMP stream or replay segments. (The
  virtual camera is the exception: FFmpeg decodes it to raw frames; see
  `docs/VIRTUAL_CAMERA.md`.) Stopping closes FFmpeg's input, which is how it finishes a file.

## Why a separate window

Measured in `docs/spikes/output-pipeline.md`:

- Web Audio runs at about 72% of real time in a window that is minimized, so a
  recording made from the main window would lose sound whenever it was minimized.
  The host is a window of its own, shown but parked far off-screen.
- `MediaRecorder` drops 20-30% of frames at the start of a recording and cannot be
  controlled. Frames and audio are therefore stamped by the host itself from one
  clock and encoded with WebCodecs.

## What is drawn

Every frame the host draws the scene from the snapshot the interface last sent:

- **Capture sources** (screen, window, camera): a `<video>` per source, kept open
  by `CapturePool` only while an output is running.
- **Color, text and image sources** (`src/lib/sources/static.ts`): painted from their
  settings by the same code the preview uses; repainted only when their look changes.
- **Filters** (`src/lib/filters/plan.ts`): one plan produces a CSS filter string, SVG
  filters for sharpen and chroma key, and a crop. The canvas applies it with
  `ctx.filter`, the preview with CSS, so the two cannot drift apart.
- **Transitions** (`src/host/transition.ts`): the interface publishes the outgoing
  scene and when the change began; the host draws the incoming scene over it (fade,
  slide or wipe) with CSS `ease-in-out` timing. The preview animates the same way.

## Audio

Captured audio is read directly and mixed by `DirectMixer`, with no Web Audio
context:

```
microphone / system audio
  -> MediaStreamTrackProcessor (chunks stamped with capture time)
  -> InputBuffer (placed on the capture clock, resampled to 48 kHz)
  -> DirectMixer (sums with each fader and mute, cuts 1024-frame blocks)
  -> AudioTimeline (lays blocks end to end against the wall clock) -> Opus
```

Web Audio was tried first. Its render clock fell behind under video load (measured
at 95% of real time at 1080p60), so about 5% of the sound was lost and replaced
with silence. The capture devices keep time exactly (measured 99.96%), so the mixer
follows them instead. Outcome at 1080p60: 89 ms of silence inserted in a 45 s
recording, down from 1.6 s, and drift under 1 ms/min.

Which microphone to use is chosen in Settings, Audio, and travels to the host with
the mixer state. System audio is captured as everything the computer plays.

## Timing

- Video frames are stamped with `performance.now()` when they are composed.
- Audio blocks carry capture-clock times; the host maps them to `performance.now()`
  using the smallest delivery delay seen recently, and `AudioTimeline` corrects only
  if they stray more than 20 ms.
- The encoder gets a larger queue allowance for its first two seconds, because a
  hardware encoder takes a moment to start; without it the first 30 frames of a
  1080p60 recording were dropped.

## Checking it

`scripts/e2e/record.cjs` launches the **built** app (or an unpacked one with
`--exe=`) with a fresh profile, drives it over the DevTools protocol, records with the
window minimized, and measures the file.

```
npx electron-vite build
node scripts/e2e/record.cjs 60 --sync                    # frame rate, stalls, audio/picture offset and drift
node scripts/e2e/record.cjs 40 --res=1920x1080 --fps=60 --sync
node scripts/e2e/record.cjs 30 --kind=streaming          # to a local RTMP receiver
node scripts/e2e/record.cjs 40 --kind=replay             # fill the buffer, save, measure
node scripts/e2e/record.cjs 15 --kind=vcam
node scripts/e2e/record.cjs 25 --sync --arrange          # source shrunk to the middle: corners must stay black
node scripts/e2e/record.cjs 15 --overlay                 # a colour box and a text box in the recording
node scripts/e2e/record.cjs 15 --filters                 # chroma key, saturation 0 and crop in the recording
node scripts/e2e/record.cjs 10 --transition=fade         # also slide, wipe: reports each half of the picture over time
node scripts/e2e/record.cjs 40 --sync --mic              # microphone as well as system audio
```

`--sync` puts a full-screen flash-and-beep signal on screen, so it flashes and
plays sound on your machine while it runs. It records your real screen; the
recording is measured and then deleted (pass `--keep` to keep it). Do not open the
recordings: they can show whatever was on the screen.

## Measured results

On an i5-1135G7 laptop with system audio:

| Case | Result |
|---|---|
| 720p30, 4 minutes | 30.0 fps, 0 dropped, memory flat |
| 1080p30, 4 minutes | 30.0 fps, 0 dropped, memory flat at 1.5 GB |
| 1080p60, 60 seconds, twice | 60.0 fps, 0 dropped, longest gap 34 ms, drift 0.1-0.3 ms/min, median audio offset 47-61 ms |
| Frame cost | 0.4 ms to draw, 0.2 ms to hand to the encoder |

Not yet covered: weaker machines, more than one display, and recordings longer than
a few minutes at 1080p60.

## Streaming that does not stutter or break

- **Priority.** While an output runs, the output host and the graphics process that serve it are given high priority (`raiseOutputPriority`, `electron/main/host/window.ts`). With the interface window visible at normal priority, frames arrived late often enough to show as stutter: 33 to 79 late frames in 40 seconds, gaps up to 167 ms. With the priority raised: none, longest gap one frame (34 ms), at 30.0 fps over 40 and 90 seconds.
- **Constant bitrate.** A stream asks the encoder for a constant bitrate (`SessionParams.constantBitrate`), so a burst above the upload speed does not stall it. An encoder that cannot hold one falls back to variable.
- **Reconnecting.** If FFmpeg's connection is lost after a stream was live, the stream is not ended: the host's session is closed and a new connection is tried after 2, 4, 8 and then every 15 seconds, for about two minutes (`RECONNECT_DELAYS_MS`). The person is told it is reconnecting and when it is back; if it cannot, the stream ends with the reason. A first connection that fails still fails at once. Pressing stop while reconnecting cancels it.
- **Startup check.** FFmpeg dying while the host was still starting used to be missed and the output counted as started.
- **The warning for a stream** names the internet upload speed as a likely cause and says what to lower.

Test: `node scripts/e2e/record.cjs 60 --kind=streaming --drop` streams to a local server, stops the server, brings it back and prints when the app reconnected.
