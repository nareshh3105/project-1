# CodeBuilders v0.5.0

First build on the new Electron platform.

## Install

Download **CodeBuilders_0.5.0_x64-setup.exe** and run it. Windows 10/11, 64-bit.

Windows will show an *"unrecognised app"* warning — this build is not code
signed yet. Click **More info → Run anyway**. Signing is pending the
certificate; released builds will not show this.

FFmpeg must be installed and on PATH for recording, streaming, replay buffer
and virtual camera. The app detects it at startup and tells you if it is
missing:

    winget install --id Gyan.FFmpeg -e

## What's in this build

- Scenes and sources with live preview, studio mode and multiview
- Recording, RTMP streaming, replay buffer, virtual camera, screenshots
- Audio mixer with per-channel noise suppression
- Scene filters: colour correction, crop, chroma key, blur, sharpen
- Profiles, scene collections with import/export, global hotkeys, plugins

## Changes since v0.4.0

- Rebuilt on Electron; the whole backend was ported from Rust
- Automated test suite added (264 tests)
- Fixed: deleting a scene collection left orphaned data behind
- Fixed: streaming status never reached the interface, so the Stop button
  never appeared during a live stream
- Fixed: two recordings or screenshots in the same second overwrote each other
- Fixed: fullscreen preview, screenshot, open recordings folder and multiview
  were clickable but did nothing

## Known limitations

- Windows only
- Not code signed
- Audio meters are animated placeholders, not real levels
- No licensing or payment system

Installer is ~112 MB because Electron bundles its own browser engine. The
earlier 6 MB builds (v0.1.0–v0.4.0) used the Windows WebView runtime.
