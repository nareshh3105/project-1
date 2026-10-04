# CodeBuilders 0.8.0

This release also contains everything from 0.7.0, which was never published: the new output engine.

## Install

Download **CodeBuilders_0.8.0_x64-setup.exe** below and run it. Windows will say "Windows protected your PC" because this build is not code-signed yet: choose **More info**, then **Run anyway**. FFmpeg is included. Your scenes and settings carry over from earlier versions.

Do not go back to an older version after using this one; it will refuse to open the newer data.

## What is new

**Recording and streaming now work the way a streaming app should** (0.7.0)
- Recording, streaming, the replay buffer and the virtual camera are drawn and mixed by a dedicated output engine, so what you arrange in the preview is what is recorded, and recording carries on when the window is minimized.
- Hardware video encoding when the computer has it, with a software fallback.
- Sources can be dragged, resized and nudged in the preview.
- Faders, mutes and connected inputs are remembered and reconnect when the app starts.

**New in 0.8.0**
- **Image, Text and Color sources**, edited from right-click, Properties.
- **Filters** on any source: Color Correction, Crop, Chroma Key, Blur and Sharpen, shown in the preview and in the recording.
- **Scene transitions** (Fade, Slide, Wipe) in Studio Mode now play in the recording as well as on screen.
- **Choose your microphone** in Settings, Audio.
- **Audio rewritten** to read the capture devices directly. At 1080p60 the old path lost about 5% of the sound under video load; now it loses almost none.
- 1080p at 60 fps measured 60.0 fps with no dropped frames on the test laptop.
- Fixed: a scene staged in Studio Mode did not load its sources until it went on air.

## Known limitations

- Media, Browser and Scene sources are not available yet.
- One audio track per file. Sound is the chosen microphone plus everything the computer plays.
- The virtual camera is a video stream on `udp://127.0.0.1:12345` (for OBS, VLC, FFmpeg); it does not appear as a webcam in Zoom or Teams.
- Sound can be up to about 60 ms behind the picture; it does not drift.
- Tested on one laptop. Reports from other computers are very welcome: **Help, Report a Bug**.
- Windows only.

See `docs/TESTER_GUIDE.md` for a checklist and `docs/OUTPUT.md` for how it works.
