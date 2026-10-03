# Spike: composing the scene and feeding the encoder

**Question.** Recordings and streams currently capture the whole desktop
(`gdigrab -i desktop`), so scenes, source positions, filters and the audio
mixer have no effect on the output. To behave like OBS, the output has to be
what the user composed. Can the renderer compose the scene and feed an encoder
reliably enough to build that on?

**Short answer.** Yes, with constraints. MediaRecorder cannot be used. A
WebCodecs pipeline that stamps its own timestamps gives a clean picture, even
with the window minimized. **The audio clock is the exception: Web Audio runs at
about 72% of real time in a minimized or hidden window**, so the pipeline has to
live in a window that is never minimized or hidden (section 7). 1080p60 is not
clean yet.

Code: `spike/pipeline/`. It is an experiment, not app code, and runs in its own
Electron instance with a throwaway data folder.

## How it is measured

The test scene is built so the output file can be checked without watching it.
Every frame differs (moving bar, counter) so an idle encoder cannot hide drops.
The whole frame flashes white for 100 ms at each whole second, and a 1 kHz beep
sounds at the same instants over digital silence. From the file alone:

- frames received, and the longest gap between them
- when each flash appears versus when each beep begins: sync offset and drift
- CPU of the renderer, GPU, main process and FFmpeg, and memory over time

`analyze.cjs` does the file analysis; `run.cjs` runs the scenario matrix;
`encoders.cjs` isolates MediaRecorder.

## What was found

### 1. MediaRecorder loses frames and cannot be fixed

Over a 12-second foreground run, the page drew 362 frames, a second reader on
the captured track saw 361, and the recorded file held 294. A 2.5 second hole
opened about 0.3 s after recording started. It was the same for H.264, VP8 and
VP9, in both capture modes, at 1080p and 720p, with and without an audio track,
and whether or not the page had been running for several seconds first. It also
occurs with FFmpeg out of the path (recorder output written straight to disk).
So the loss is inside MediaRecorder's encoder, which exposes no controls.
Keyframes were also about 3.4 s apart, with no way to set them.

### 2. Canvas capture gives unusable timestamps

Reading frames from `canvas.captureStream()` returned them in pairs sharing one
timestamp (5061, 5061, 5127, 5127 ms ...). Audio timestamps were on a different
clock entirely (uptime, about 69,736 s) from video (starting near 0), so the two
tracks could not be aligned.

### 3. WebCodecs with our own timestamps works

The pipeline builds each `VideoFrame` directly from the canvas at the moment it
is composed, with a timestamp from `performance.now()`. Audio goes through an
AudioWorklet, which reports the exact sample position of each block; that is
mapped onto the same clock once, from a paired reading of the two clocks. Both
tracks go to `VideoEncoder` (H.264, realtime) and `AudioEncoder` (Opus), then a
fragmented-MP4 muxer, then FFmpeg (`-c:v copy`, AAC audio).

Scenario matrix, 30 s each, WebCodecs engine:

| Scenario | Frames in file / expected | fps | Longest gap | Sync (audio − video) | Renderer CPU | GPU | FFmpeg |
|---|---|---|---|---|---|---|---|
| Foreground | 893 / 901 | 29.8 | 233 ms | +16 ms | 3% | 7% | 9% |
| Minimized, protections on | 892 / 901 | 29.7 | 267 ms | +16 ms | 2% | 5% | 9% |
| Minimized, **default** settings | **31 / 901** | **1.0** | 1967 ms | | 1% | 0% | 1% |
| Minimized, `requestAnimationFrame` loop | 348 / 901 | 11.6 | 1034 ms | | 2% | 2% | 6% |
| Hidden, protections on | 882 / 901 | 29.4 | 533 ms | +15 ms | 3% | 6% | 8% |
| Real screen capture layer | 879 / 901 | 29.3 | 500 ms | +15 ms | 4% | 8% | 9% |
| Real screen capture, minimized | 871 / 901 | 29.0 | 733 ms | +25 ms | 4% | 7% | 7% |
| 1080p60 | 1465 / 1802 | 48.8 | 367 ms | +1 ms | 5% | 12% | 11% |
| Software H.264 | 900 / 901 | 30.0 | 67 ms | +15 ms | 10% | 3% | 5% |

CPU is a percentage of one core. Sync is a constant offset of about 15 to 25 ms
with audio slightly late; that is the kind of offset OBS exposes as a per-source
"sync offset", and it can be calibrated.

Frame accounting at every stage:

- The page drew 900 to 901 frames in each protected run. The compose loop is
  steady, including when minimized or hidden.
- **Frames encoded always equalled frames in the file.** Nothing is lost in the
  muxer or the FFmpeg pipe.
- The loss that remains is at the encoder's input queue, covered next.

### 4. Two protections are mandatory

With default Electron settings and the window minimized, the page drew 32 of 900
frames. A recording made while the app was minimized or covered by a game would
run at about 1 fps. The protections that fix it:

- `backgroundThrottling: false` on the window
- the Chromium switches `disable-renderer-backgrounding`,
  `disable-background-timer-throttling`, `disable-backgrounding-occluded-windows`,
  and `disable-features=CalculateNativeWinOcclusion`
- **drive composition with timers, never `requestAnimationFrame`**, which stops
  while minimized even with the protections (348 of 900 frames)

### 5. The first drop threshold was my mistake

The first runs dropped 6 to 28 frames per 30 s on the hardware encoder. The cause
was my rule "drop a frame if more than 6 are queued": the hardware encoder's
normal pipeline depth is about 7. With a limit of 30, 1080p30 on the hardware
encoder delivers 600 of 601 frames, with a longest gap of 67 ms and none dropped.

### 6. 1080p60 is not clean on this machine

Even with the generous limit, 1080p60 loses 32 of 1,197 frames (hardware encoder,
queue limit 30) and 54 of 1,185 (software encoder, using 26% of a core). The
compose loop itself kept up (drawn 1,185 to 1,197 of about 1,200). This needs
more work before 60 fps is promised: the cost of creating a `VideoFrame` from a
1080p canvas, and encoder throughput, are the places to look.

## Constraints this puts on the real implementation

1. Use WebCodecs. Do not use MediaRecorder or `captureStream` for output.
2. Own the clock. Stamp every video frame and audio block from one clock where
   it is produced. Never trust timestamps handed over by a capture API.
3. Compose on timers, with throttling protections applied to the window that
   hosts the compositor, and test minimized, hidden and covered states.
4. Set the drop threshold from the encoder's real pipeline depth, not a small
   constant; a hardware encoder needs a larger allowance than software.
5. Keyframes every 2 seconds, set explicitly (streaming services expect this).
6. Fall back from hardware to software H.264 automatically when
   `VideoEncoder.isConfigSupported` says no; the software path was clean at
   1080p30 and costs about 10% of a core.
7. Re-anchor the audio/video clock relationship continuously in long sessions,
   since the two clocks run on different oscillators; even in a visible window
   the audio clock read 98.6% of real time over 90 seconds.
8. Run audio and composition in a window that is never minimized or hidden
   (section 7). This is a requirement, not an optimisation.
9. Close every `AudioData` and `VideoFrame` after handing it to an encoder.
   Skipping it leaks memory steadily and can break a long recording.

## Not yet tested

- Streaming to a real RTMP server, including behaviour under limited bandwidth.
- Several simultaneous 1080p sources and a webcam, which is a heavier load than
  one screen layer.
- Output quality: bitrate was matched in some runs but picture quality was not
  compared between the hardware and software encoders.
- Other hardware: this is one machine and one GPU. Intel, NVIDIA and AMD
  encoders behave differently, which is why the software fallback matters.
- Battery-powered operation. Windows timer resolution is coarser on battery,
  which may add timing jitter to a timer-driven compositor. The measurements
  above were taken on a laptop that was not at full charge.
- The virtual camera, which needs a Windows driver component and is a separate
  piece of work.

### 7. Web Audio runs slow when its window is minimized or hidden

A ten-minute soak (minimized, real screen capture, hardware encoder) had a flawless
picture: 17,985 frames drawn with no gap over 100 ms, 17,984 encoded, none dropped,
300 keyframes exactly two seconds apart, flat CPU (renderer about 4%, GPU about 9%).

The audio, however, stopped at about 456 seconds. Chasing it:

| Idea | Result |
|---|---|
| Unclosed `AudioData` objects leak memory | A real bug, fixed (about 0.4 MB/s), but the audio still stopped at 458 s |
| The worklet node is garbage-collected | Falsified: forcing collection every 10 s changed nothing |
| Chromium efficiency mode (`UseEcoQoSForBackgroundProcess`) | No effect |
| Route the graph to the real output device | No effect |

What the per-second diagnostics showed: the audio did not die. The context stayed
"running" and kept delivering blocks, but **its clock ran slow**, so it produced fewer
samples per second of real time. 458 seconds of audio over a 600 second run is a
clock at 76%.

| Window state | Audio clock speed (real time = 100%) |
|---|---|
| Foreground | 100.2% |
| Minimized | 72% |
| Minimized, efficiency mode disabled | 75.7% |
| Hidden (`win.hide()`) | 77.7% |
| **Visible but parked off-screen** | **98.6%** |

So Chromium slows Web Audio for a window that is minimized or hidden, and no flag
changes it. A window that counts as visible does not slow down, even with nobody able to
see it. With live audio (a microphone or system loopback) this would make audio drift
out of step with the video, steadily, whenever the app is minimized. The earlier
sync check could not see it, because its beeps and its timestamps were both on the
audio clock.

The video path does not have this problem: timer-driven composition held 30 fps
minimized and hidden.

**Consequence.** Audio capture, mixing and encoding, and composition with it, run in a
dedicated output window that is kept visible but parked off-screen. The main window is
then free to be minimized, as it is in OBS. Keeping output off the interface thread is
also what stops UI work from adding timing jitter to the recording.

## Reproducing

```
node spike/pipeline/run.cjs --duration=30        # the scenario matrix
node spike/pipeline/run.cjs --list               # what each scenario changes
node spike/pipeline/encoders.cjs                 # MediaRecorder in isolation
node spike/pipeline/analyze.cjs <file> <fps>     # analyse any recording
```

`resources/ffmpeg/ffmpeg.exe` must be present (`npm run fetch-ffmpeg`).
