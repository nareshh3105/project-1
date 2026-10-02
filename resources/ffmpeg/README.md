# FFmpeg

The installer ships `ffmpeg.exe` from this folder, and the app looks here first
(then on the PATH). The binary is not committed.

```
npm run fetch-ffmpeg
```

That downloads the Windows "essentials" build and puts `ffmpeg.exe` and its
licence here. `npm run release` refuses to build without it, so an installer can
never go out without FFmpeg.

To use a copy you already have:

```
powershell -File scripts/fetch-ffmpeg.ps1 -From "C:\path\to\ffmpeg.exe"
```

The build used is GPL v3. See the note at the top of `scripts/fetch-ffmpeg.ps1`
before distributing outside the team.
