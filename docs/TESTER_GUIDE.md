# CodeBuilders tester guide

This is for the team trying out a build before it goes further. You do not need
to build anything: install it, use it the way you would really use it, and tell
us what breaks.

## Installing

1. Get the installer for the version you were sent, `CodeBuilders_<version>_x64-setup.exe`.
2. Run it. **Windows will show "Windows protected your PC".** That appears
   because this build is not code-signed yet. Choose **More info**, then
   **Run anyway**. It happens once per installer file.
3. Finish the installer and start CodeBuilders from the desktop shortcut.

FFmpeg is included. You do not need to install it separately.

To remove it: Settings → Apps → CodeBuilders → Uninstall. Your scenes and
settings are kept in `%APPDATA%\CodeBuilders` and are left in place, so
reinstalling picks up where you were.

## Updating to a newer build

Install the new version over the old one. Your scenes, sources and settings
carry across. Before the database is changed in an update, a copy is saved next
to it (`codebuilders.db.bak-…` in `%APPDATA%\CodeBuilders`); the last three are
kept.

**Do not go back to an older build after using a newer one.** The older version
will refuse to open the newer data and show a message saying so. That is
deliberate, to protect your work. Install the newer version again.

If you open CodeBuilders a second time, the existing window is brought to the
front instead of starting another copy.

## What to try

Work through these, and then use it freely. Note anything that is confusing as
well as anything that is broken.

**First run**
- [ ] The app opens, and the empty preview tells you what to do.
- [ ] Add a Display Capture source and pick a screen. It appears in the preview.
- [ ] Add a second source (a window, or a camera). Both show in the preview.

**Scenes and sources**
- [ ] Add, rename, duplicate and delete scenes. New scenes get sensible names.
- [ ] Reorder sources, hide one, lock one.
- [ ] Remove a source that is capturing. The "sharing your screen" indicator should go away.
- [ ] Close and reopen the app. Everything is still there.

**Recording and streaming**
- [ ] Start and stop a recording. The file appears in your Videos folder and plays.
- [ ] Record twice quickly. You get two files, neither overwritten.
- [ ] Replay buffer: start it, wait, save a replay.
- [ ] Streaming, only if you have a test stream key. **Do not paste a real stream key into a bug report.**

**Audio**
- [ ] Connect the microphone and the desktop audio from the Audio Mixer header. The meters move.
- [ ] Mute a channel. The strip dims.

**Settings**
- [ ] Change a setting, press Cancel, reopen. It did not change. Change it, press OK. It did.
- [ ] Rebind a hotkey, press Escape while recording it. Settings should stay open.

**Things that should fail politely**
- [ ] Unplug or disable a device mid-recording.
- [ ] Fill a drive, or record to a read-only folder.

## Reporting a problem

1. In the app choose **Help → Copy Diagnostics**.
2. Choose **Help → Report a Bug**, fill in the form, and paste the diagnostics
   where it asks. Screenshots or a short recording help a lot.

If the app will not start at all, it shows a message explaining why. Include
that, and the newest file from `%APPDATA%\CodeBuilders\logs`.

## Known limitations

- Image and text sources are placeholders in the preview; they are not drawn yet.
- Sources cannot yet be dragged or resized in the preview.
- The Language setting is not wired to anything yet; the app is English only.
- Audio device choices in Settings → Audio are not applied yet. Use the
  Mic and Desktop buttons in the Audio Mixer.
- Hotkey changes in Settings apply immediately and are not reverted by Cancel.
- Windows only.
