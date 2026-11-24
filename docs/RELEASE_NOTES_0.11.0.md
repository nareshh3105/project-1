# CodeBuilders 0.11.0

## Install

Download **CodeBuilders_0.11.0_x64-setup.exe** and run it. Windows will say "Windows protected your PC" because this build is not code-signed yet: choose **More info**, then **Run anyway**. Your scenes and settings carry over.

## What is new

- **Different quality for recording and streaming.** Settings, Output: "Recording quality" and "Streaming quality" each have their own resolution and frame rate, and the stream its own bitrate. For example, record 1080p60 for editing while streaming 720p30 that your upload can carry. Both follow the Video tab until you change them.
- **Microphone filters.** Each channel in the Audio Mixer has an **FX** button: gain, noise gate (silences keyboard and fan noise between words) and compressor (evens out loud and quiet speech). Changes apply straight away to what is recorded and streamed.

## Known limitations

- The mixer's meter shows the sound before the filters, not after.
- Recording 1080p60 while streaming at the same time can drop a few frames on a slower computer; each alone runs at full rate.
- Sign in with Google for YouTube is built but not switched on in this build. Paste your stream key as before.
- The virtual camera has one size (1280x720). Uninstalling CodeBuilders does not remove it; use Tools, Remove Virtual Camera first.
- Scene source is not available yet. Windows only.
