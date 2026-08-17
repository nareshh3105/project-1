# Packaging

```bash
npm run release
```

Builds the renderer, main and preload bundles, packages NSIS and MSI
installers, and archives them to `versions/v<version>/` alongside a
`build-info.json`. It refuses to overwrite a version that already has
installers unless you pass `-Force`, so earlier releases cannot be lost.

Bump `version` in `package.json` before each release. That single field drives
the installer filenames, the archive folder, and the updater manifest.

## Output size

| | |
|---|---|
| NSIS installer | ~112 MB |
| MSI installer | ~125 MB |
| Installed | ~406 MB |

This is the expected cost of the Electron runtime, which ships its own copy of
Chromium. The earlier Tauri build produced a 6 MB installer because it used the
WebView2 runtime already present in Windows. The trade was made deliberately:
see DC-1 in `docs/SRS.md`.

## If packaging fails with EBUSY or EPERM

Symptom, partway through packaging:

```
⨯ EBUSY: resource busy or locked, unlink '...\win-unpacked.tmp\resources\default_app.asar'
```

electron-builder extracts the Electron distribution into the output directory,
and a security product's real-time scanner opens the extracted files to inspect
them. The handle is still held when electron-builder tries to rename the
directory, so the step fails. No process of ours appears in the task list,
because the handle belongs to a filter driver.

It reproduces on every attempt in an affected directory — waiting does not
help.

Two fixes, either works:

**Add an exclusion** for the project folder in your security software. This is
the better long-term answer, since it also speeds up `npm install` and the
renderer build.

**Build somewhere less aggressively scanned.** User profile folders such as
Desktop and Documents are usually watched more closely than a top-level path:

```bash
npm run release -- -OutDir C:/cb-build
```

The archive still lands in `versions/`; only the intermediate build directory
moves.

## Icons

`build/icon.ico` and `build/icon.png` supply the executable, installer and
shortcut icons. The MSI target fails to link without the `.ico`:

```
error LGHT0094 : The identifier 'Icon:CodeBuildersIcon.exe' could not be found
```

Replace both files when the client's branding is finalised.

## Native modules

`better-sqlite3` compiles against Electron's ABI rather than the system Node's.
`electron-builder install-app-deps` runs on `postinstall` and handles this, but
after changing the Electron version run:

```bash
npm run rebuild
```

The module is also unpacked from the asar archive (`asarUnpack` in
`electron-builder.yml`), because a `.node` binding cannot be loaded from inside
one.
