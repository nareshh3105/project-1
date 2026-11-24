# CodeBuilders 0.10.0

## Install

Download **CodeBuilders_0.10.0_x64-setup.exe** and run it. Windows will say "Windows protected your PC" because this build is not code-signed yet: choose **More info**, then **Run anyway**. Your scenes and settings carry over.

## What is new

- **Virtual camera that Zoom, Teams and browsers can use.** Start Virtual Camera, then choose "CodeBuilders Virtual Camera" in the other app. 1280x720 at 30 fps, no sound. The first time, the app asks to install it and Windows asks for administrator approval (once). Tools, Remove Virtual Camera takes it off again. Windows 11 only.
- **Stream to YouTube or Twitch by name.** Stream Settings, Service: choose YouTube, paste your stream key from YouTube Studio, Go Live. The server address is filled in.
- **Smoother streams.**
  - No more stutter with the CodeBuilders window open (the output engine now runs at a higher priority than the preview).
  - Streams use a steady (constant) bitrate.
  - If the connection drops, the stream reconnects by itself for about two minutes instead of ending.
  - If a stream cannot keep up, the warning says whether to lower the bitrate for your upload speed.

## Tips for a smooth stream

- Set Settings, Output, Video Bitrate below your upload speed: about 4 Mbps for 720p, 6 Mbps for 1080p.
- Test with an unlisted or private YouTube stream first.

## Known limitations

- The virtual camera has one size (1280x720). Uninstalling CodeBuilders does not remove it; use Tools, Remove Virtual Camera first.
- Scene source is not available yet.
- Tested on one laptop. Windows only.
