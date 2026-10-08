# Virtual camera

A webcam that Zoom, Teams, browsers and other apps can pick, showing the scene
CodeBuilders is composing. Windows 11 only (it uses Windows' own virtual camera
support, `MFCreateVirtualCamera`).

## Using it

Controls, Start Virtual Camera (or Tools, Start Virtual Camera). In the other
app, choose **CodeBuilders Virtual Camera**. The picture is 1280x720 at 30 fps,
whatever the output size is set to, and there is no sound.

The first time, the app explains and asks before installing it, and Windows then
asks for **administrator approval**. This is needed because Windows loads camera
sources in a system service that cannot see a single user's files or registry.
Tools, Remove Virtual Camera undoes it (also with an approval).

## How it works

```
output host (H.264) -> main process -> FFmpeg (decode, scale, NV12 on stdout)
    -> main process, a local server on 127.0.0.1:12347
    -> the camera (inside Windows' Frame Server service) connects and reads frames
    -> apps that open "CodeBuilders Virtual Camera"
```

- `native/vcam/` is the camera: a COM media source DLL (`source.cpp`) and the
  program that creates the camera and keeps it alive (`tool.cpp`, shipped as
  `CodeBuildersCameraHost.exe`). `native/vcam/build.cmd` builds both with Visual
  Studio Build Tools and puts them in `resources/vcam/`, which is kept in git so
  that building the app needs no compiler.
- The DLL is installed to `C:\ProgramData\CodeBuilders\vcam\CodeBuildersCamera-<hash>.dll`
  and registered under `HKLM\Software\Classes\CLSID\{B4D1A2C7-5E3F-4C1A-9D6B-2F7E8A3C1D90}`.
  The name carries a hash of the file, so an update never meets the old file still
  loaded, and the app can tell whether the installed copy is current.
- The camera exists only while `CodeBuildersCameraHost.exe` runs; stopping the
  output ends it.
- With the app sending nothing, the camera shows a dark frame with a moving bar.

## Limits

- Anything on this computer can connect to port 12347 and send the camera
  pictures while the virtual camera is running (loopback only, never from another
  computer). The camera does not check who is sending.
- One size (1280x720) and one frame rate (30).
- Uninstalling CodeBuilders does not remove the camera; use Tools, Remove Virtual
  Camera first.
- The installed DLL is not code-signed.

## Testing

```
node scripts/e2e/record.cjs 12 --kind=vcam
```

starts the camera from the real app, reads it back through Windows the way an app
does, and prints the frame count, size and frame rate (numbers only).
