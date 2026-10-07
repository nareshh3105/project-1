# CodeBuilders 0.9.0

## Install

Download **CodeBuilders_0.9.0_x64-setup.exe** and run it. Windows will say "Windows protected your PC" because this build is not code-signed yet: choose **More info**, then **Run anyway**. FFmpeg is included. Your scenes and settings carry over.

Do not go back to an older version after using this one.

## What is new

- **Media source**: play a video or sound file in the scene; its sound is mixed into recordings.
- **Browser source**: show a web page with a transparent background.
- **Several audio tracks** in recordings (Settings, Output, Audio Tracks): the mix, the microphone alone, and everything else alone.
- **Scene transitions** (Cut, Fade, Slide, Wipe) when you click a scene in normal mode.
- **Weaker computers**: real FPS, bitrate and dropped frames in the status bar, a warning when the computer cannot keep up, and Quality / Balanced / Performance / Light presets in Settings, Output.

## Fixed

- New scenes continue the numbering (Scene 4 after deleting Scene 2).
- Two scenes in a collection can no longer have the same name.
- A camera no longer stays on after its source is removed.
- The REC and Duration clocks counted nothing; they now run.
- Settings: toggles no longer overflow their track, and dividers no longer cut through notes.
- Screenshot and Settings are no longer on both the toolbar and the Controls panel.
- When something fails (for example Save Replay too early) the message now says why.

## Known limitations

- Scene source is not available yet.
- Extra audio tracks are for recordings only. Open the file in a player that lets you pick the audio track (VLC, for example).
- A browser source has no sound and cannot be clicked.
- The virtual camera is a video stream on `udp://127.0.0.1:12345` (for OBS, VLC, FFmpeg); it does not appear as a webcam in Zoom or Teams.
- Save Replay needs about 10 seconds of replay buffer first.
- Tested on one laptop. Reports are welcome: **Help, Report a Bug**.
- Windows only.
