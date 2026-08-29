# CodeBuilders — Architecture Reference

> Current as of v0.5.0, the first build on Electron. The Rust/Tauri
> implementation this replaced remains in git history.

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Shell | Electron 43 | Main process in TypeScript on Node |
| Build | electron-vite 5 | Separate bundles for main, preload and renderer |
| Packaging | electron-builder 26 | NSIS and MSI targets |
| Frontend | React 18 + TypeScript 5 strict | Unchanged by the migration |
| Styling | Tailwind CSS + shadcn/ui | CSS vars wired to tokens.json |
| State | Zustand 4 + Immer | One store per domain, no Context API |
| Dock layout | FlexLayout React 0.7 | Persisted to localStorage as JSON |
| Canvas | HTML Canvas (preview) + React Konva (transform handles) | NOT mixed on the same canvas |
| Capture | getDisplayMedia / getUserMedia | Runs in the renderer, not the backend |
| Encoding | FFmpeg, spawned as a child process | Must be on PATH; not bundled (see Key Decisions) |
| Database | SQLite via better-sqlite3 13 | Synchronous, single connection |
| System stats | systeminformation | CPU and memory sampling |
| Updates | electron-updater | Inactive until builds are signed |
| Tests | Vitest 1.6 | 264 tests; see docs/TESTING.md |

---

## Process Model

Electron runs two processes that exchange messages. The split matters for
security: the renderer has no direct access to Node or the filesystem.

```
┌────────────────────────────┐        ┌────────────────────────────┐
│  Renderer (Chromium)       │        │  Main (Node)               │
│                            │        │                            │
│  React interface           │        │  Command registry          │
│  Zustand stores            │◄──IPC─►│  SQLite                    │
│  Screen capture            │        │  FFmpeg subprocesses       │
│  src/ipc/index.ts          │        │  OS integration            │
└────────────────────────────┘        └────────────────────────────┘
              ▲                                     │
              │ contextBridge                       ▼
       electron/preload                   ffmpeg · sqlite · shell
```

Screen and camera capture happen in the **renderer**, using the standard media
APIs. The main process never touches the video stream; it only spawns FFmpeg,
which captures independently via gdigrab.

---

## Folder Structure

```
project 1/
├── electron/
│   ├── main/
│   │   ├── index.ts              # App lifecycle, window, cleanup on quit
│   │   ├── ipc.ts                # Command registry, dispatch, event emit
│   │   ├── db/
│   │   │   ├── index.ts          # Connection, schema, orphan cleanup
│   │   │   └── mappers.ts        # snake_case rows to camelCase DTOs
│   │   ├── output/
│   │   │   ├── ffmpeg.ts         # Process spawning, sessions, graceful stop
│   │   │   └── args.ts           # Argument construction (extracted to test)
│   │   └── commands/             # One module per domain; each registers
│   │       ├── scenes.ts         #   its commands by name
│   │       ├── sources.ts
│   │       ├── collections.ts
│   │       ├── output.ts         # Recording, streaming, replay, vcam
│   │       ├── audio.ts
│   │       ├── stats.ts
│   │       ├── screenshot.ts
│   │       ├── plugins.ts
│   │       ├── hotkeys.ts
│   │       ├── updater.ts
│   │       ├── window.ts         # Fullscreen, always-on-top, dialogs, file IO
│   │       └── app.ts
│   └── preload/
│       └── index.ts              # contextBridge — the only renderer surface
│
├── src/                          # React interface (unchanged by the migration)
│   ├── ipc/index.ts              # Typed wrapper over the bridge
│   ├── stores/                   # Zustand, one per domain
│   ├── components/
│   └── lib/
│
├── test/
│   ├── main/                     # Backend suites (Node environment)
│   ├── renderer/                 # Store and helper suites (jsdom)
│   └── mocks/                    # electron and child_process stubs
│
├── docs/                         # SRS, status report, testing guide
├── scripts/                      # release.ps1, md2pdf.py, packaging notes
├── build/                        # Installer icons
└── versions/                     # Archived releases
```

---

## State Architecture

```
Component
    │  reads selector
    ▼
Zustand Store  (Immer middleware — safe nested mutations)
    │  dispatch action
    ▼
src/ipc/index.ts       ← typed wrapper; the only module touching the bridge
    │  window.codebuilders.invoke('command', args)
    ▼
electron/preload       ← contextBridge; exposes invoke and on, nothing else
    │  ipcRenderer.invoke('cb:invoke', name, args)
    ▼
electron/main/ipc.ts   ← single dispatcher, looks the name up in the registry
    │
    ▼
Command handler        ← electron/main/commands/*
```

**Rule:** components never reach the bridge directly. Everything goes through
`src/ipc/index.ts`, which is what made the platform migration possible without
touching the interface — only that file's internals changed.

---

## IPC Event Flow (Main to Renderer)

Events travel on one channel and are filtered by name in the preload, so the
renderer never enumerates channels.

```
Main:       emit('output:recording-status', { active, filePath })
            emit('audio:levels', [...])
            emit('stats:update', RuntimeStats)
            emit('hotkey:pressed', { action })
                │  webContents.send('cb:event', name, payload)
                ▼
Preload:    filters by name, invokes the subscriber's callback
                ▼
Renderer:   onRecordingStatus(cb) → outputStore.setRecordingStatus()
            onStatsUpdate(cb)     → uiStore.setStats()
```

Event names are constants in `src/lib/constants.ts → IPC_EVENTS`. The backend
must emit exactly those strings — a mismatch fails silently, which is how the
streaming indicator stayed broken for the entire life of the Rust build.

---

## Security Model

Electron is not safe by default. These settings are required, not optional:

| Setting | Value | Why |
|---|---|---|
| `contextIsolation` | `true` | Renderer cannot reach preload internals |
| `nodeIntegration` | `false` | No Node APIs in the web context |
| `sandbox` | `false` | Needed for the preload to import electron |

The renderer's entire capability is the command registry. If a page were
compromised, it could call registered commands — it could not read the
filesystem or spawn processes directly.

Paths derived from untrusted input are containment-checked. A plugin
manifest's entryPoint, and the stored config_path, are both resolved and
verified to sit inside the plugins directory before anything is read or
deleted.

---

## Design Token Pipeline

```
tokens.json (W3C DTCG)
    │
    ▼
src/globals.css     ← CSS custom properties (:root { --color-bg-base: #0B0B0F; ... })
    │
    ▼
tailwind.config.ts  ← theme.extend.colors references var(--color-*)
    │
    ▼
Components use:     className="bg-bg-surface text-text-primary"

src/lib/tokens.ts   ← TypeScript constants for canvas/Konva use
```

---

## Current State

| Area | Status |
|---|---|
| Core features | Complete — scenes, sources, recording, streaming, replay, virtual camera, screenshots, audio mixer, filters, multiview, studio mode, profiles, collections, plugins, hotkeys |
| Platform | Windows only. gdigrab and dshow are Windows-specific; macOS and Linux need their own capture path |
| Tests | 264. Backend meets the 70% NF-13 requires; renderer around 42% |
| Packaging | NSIS and MSI build; installers archived under `versions/` |
| Code signing | Not configured — pending certificate |
| Updates | Built but inactive; requires signed builds |
| Licensing / payment | Not implemented |

---

## Key Decisions

**Electron over Tauri** — chosen for maintainability. The product is now a
single TypeScript codebase that can be staffed without Rust experience. The
cost is size and memory: a 112 MB installer against 6 MB, and roughly 200 MB
resident against 48 MB, because Electron ships its own browser engine rather
than using the Windows WebView runtime. Recorded as DC-1 in `docs/SRS.md`.

**A single command registry rather than one IPC channel per feature** —
mirrors the model the Rust build used, so commands could be ported one at a
time against a running application. It also keeps the renderer's reachable
surface enumerable in one place.

**better-sqlite3 over an async driver** — synchronous and single-connection,
which sidesteps the class of bug that broke the Rust implementation, where a
per-connection pragma was set once against a pool and most connections ran
without it. It is a native module, so it needs rebuilding against Electron's
ABI (`npm run rebuild`) and is unpacked from the asar archive.

**FFmpeg spawned, not bundled** — avoids linking complexity, and keeps the
GPL licensing question open rather than settled by default. Bundling a
standard build would oblige the vendor to publish source. Unresolved; see
DC-16 in `docs/SRS.md`.

**Argument construction split from process handling** — `output/args.ts` is
pure and fully covered by tests, so stream mapping can be verified without
spawning anything. An off-by-one in a stream index produces a recording with
silent or duplicated tracks, which is easy to ship and expensive to notice.

**Graceful stop rather than kill** — FFmpeg is sent `q` and given a grace
period before SIGKILL. Killing outright can leave an unplayable file, because
the container index is written during shutdown.

**FlexLayout over CSS grid** — user-resizable panels that persist across
sessions. CSS grid cannot be resized by the user at runtime.

**Separate canvases for preview and Konva** — live video renders to a plain
`<canvas>` via `drawImage()`. React Konva renders transform handles on a
transparent overlay above it. They must never share a context.

**Zustand + Immer** — deeply nested source and filter mutations need Immer.
Without it, every nested update becomes a manual spread chain.
