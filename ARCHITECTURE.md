# CodeBuilders — Architecture Reference

> Phase 1 foundation. Updated as phases complete.

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Shell | Tauri 2 (Rust) | IPC, native OS, file system, window management |
| Frontend | React 18 + TypeScript 5 strict | Vite 5 bundler |
| Styling | Tailwind CSS 4 + shadcn/ui | CSS vars wired to tokens.json |
| State | Zustand 4 + Immer | One store per domain, no Context API |
| Server state | TanStack Query 5 | For async IPC calls + caching |
| Forms | React Hook Form 7 + Zod 3 | Settings modals, source property panels |
| Dock layout | FlexLayout React 0.7 | Persisted to localStorage as JSON |
| Canvas | HTML Canvas (preview) + React Konva (transform handles) | NOT mixed on same canvas |
| Encoding | FFmpeg (bundled binary via shell plugin) | Phase 3+ |
| Database | SQLite via sqlx (async) | Phase 2 |
| Audio | WASAPI / CoreAudio via Rust | Phase 3 |

---

## Folder Structure

```
project 1/
├── src/                          # React frontend
│   ├── main.tsx                  # Entry point
│   ├── App.tsx                   # QueryClient provider + AppShell
│   ├── globals.css               # Design tokens → CSS vars + Tailwind base
│   ├── vite-env.d.ts
│   │
│   ├── types/                    # Domain type system (pure TypeScript)
│   │   ├── common.ts             # Primitives: ID, Transform, Rect, Resolution
│   │   ├── scene.ts              # Scene, SceneCollection, SceneTransition
│   │   ├── source.ts             # SourceInstance, SourceDefinition, Filter, all settings
│   │   ├── audio.ts              # MixerChannel, AudioDevice, levels
│   │   ├── output.ts             # Stream/Recording/VCam status + encoder settings
│   │   ├── settings.ts           # Profile, AppSettings, VideoSettings
│   │   ├── hotkey.ts             # KeyBinding, Hotkey, HotkeyAction
│   │   ├── plugin.ts             # PluginManifest, Plugin
│   │   └── index.ts              # Barrel
│   │
│   ├── lib/
│   │   ├── utils.ts              # cn(), formatters, dB converters
│   │   ├── tokens.ts             # Typed constants from tokens.json (for canvas use)
│   │   ├── constants.ts          # IPC event names, storage keys, app defaults
│   │   └── errors.ts             # AppError, IpcError, ValidationError
│   │
│   ├── stores/                   # Zustand stores (Immer middleware)
│   │   ├── uiStore.ts            # Modal, context menu, studio mode, stats ✅ Phase 1
│   │   ├── sceneStore.ts         # Scenes, sources, active scene    ⬜ Phase 2
│   │   ├── audioStore.ts         # Mixer channels, faders, meters   ⬜ Phase 2
│   │   ├── outputStore.ts        # Stream/recording/vcam status     ⬜ Phase 3
│   │   ├── settingsStore.ts      # App + video + audio settings     ⬜ Phase 2
│   │   ├── profileStore.ts       # Profiles + scene collections     ⬜ Phase 2
│   │   └── index.ts              # Store barrel
│   │
│   ├── ipc/
│   │   └── index.ts              # Typed invoke wrapper + event listeners
│   │
│   ├── config/
│   │   └── layoutConfig.ts       # FlexLayout default model JSON
│   │
│   ├── hooks/                    # Custom React hooks      ⬜ Phase 2+
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx      # Root layout container ✅
│   │   │   ├── MenuBar.tsx       # Top menu bar          ✅
│   │   │   ├── Toolbar.tsx       # 7 tool buttons        ✅
│   │   │   ├── DockLayout.tsx    # FlexLayout host       ✅
│   │   │   └── StatusBar.tsx     # Bottom stats bar      ✅
│   │   │
│   │   ├── panels/               # Dockable panel content
│   │   │   ├── ScenesPanel.tsx   ✅ Phase 1 placeholder
│   │   │   ├── SourcesPanel.tsx  ✅ Phase 1 placeholder
│   │   │   ├── PreviewPanel.tsx  ✅ Phase 1 placeholder (canvas + safe guides)
│   │   │   ├── AudioMixerPanel.tsx ✅ Phase 1 placeholder
│   │   │   └── ControlsPanel.tsx ✅ Phase 1 placeholder
│   │   │
│   │   ├── ui/                   # shadcn/ui components (add via CLI)
│   │   ├── modals/               # ⬜ Phase 2+
│   │   ├── overlays/             # ⬜ Phase 3+
│   │   └── preview/              # ⬜ Phase 3 (canvas + Konva layer)
│   │
│   └── pages/                    # ⬜ Phase 2+ (settings, scene-collection mgr)
│
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/default.json
│   └── src/
│       ├── main.rs               # Thin entry — calls lib::run()
│       ├── lib.rs                # Builder setup + plugin registration
│       ├── error.rs              # AppError enum + CommandResult alias
│       ├── state/mod.rs          # AppState (Arc<RwLock<AppStateInner>>)
│       └── commands/
│           ├── mod.rs
│           └── app_commands.rs   # get_app_version, get_platform_info
│
├── figma-plugin/                 # Design tooling (unchanged)
├── tokens.json                   # W3C DTCG design tokens (source of truth)
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── components.json               # shadcn/ui config
└── ARCHITECTURE.md               # This file
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
IPC Layer  (src/ipc/index.ts — typed invoke wrapper)
    │  invoke('command', args)
    ▼
Tauri Command  (src-tauri/src/commands/)
    │  AppState RwLock
    ▼
Rust Engine  (Phase 2+)
```

**Rule:** Components never call `invoke()` directly. Always go through the IPC layer.

---

## IPC Event Flow (Rust → Frontend)

```
Rust engine emits:  app.emit("preview:frame", ArrayBuffer)
                    app.emit("audio:levels", LevelPayload)
                    app.emit("output:stream-status", StreamStatus)
                    app.emit("stats:update", RuntimeStats)

Frontend listens:   onPreviewFrame(cb)   → canvas.drawImage()
                    onStatsUpdate(cb)    → uiStore.setStats()
                    onLogLine(cb)        → log panel
```

All event names are typed constants in `src/lib/constants.ts → IPC_EVENTS`.

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
                    className="bg-accent-gradient"

src/lib/tokens.ts   ← TypeScript constants for canvas/Konva/chart use
```

---

## Phase Roadmap

| Phase | Scope | Status |
|---|---|---|
| **1 — Foundation** | Build system, types, stores, IPC shell, layout | ✅ Complete |
| **2 — Scenes & Sources** | sceneStore, sourceStore, SQLite, scene CRUD, source CRUD | ⬜ Next |
| **3 — Preview & Output** | FFmpeg subprocess, Rust compositor, live preview, streaming, recording | ⬜ |
| **4 — Audio** | WASAPI/CoreAudio, mixer, VU meters, faders | ⬜ |
| **5 — Settings & Profiles** | Settings UI, profile manager, hotkeys, auto-config | ⬜ |
| **6 — Studio Mode & Multiview** | Program/Preview split, transitions, multiview grid | ⬜ |
| **7 — Plugins** | JS sandbox plugin host, plugin manager UI | ⬜ |
| **8 — Polish** | Onboarding, crash recovery, update system, release | ⬜ |

---

## Key Decisions

**FlexLayout over CSS grid** — user-resizable panels that persist layout across sessions. CSS grid cannot be resized by the user at runtime.

**Separate canvases for preview and Konva** — live video frames render to a plain `<canvas>` via `drawImage()`. React Konva renders transform handles on a transparent overlay canvas on top. They must never share a canvas context.

**Zustand + Immer** — deeply nested source/filter mutations require Immer. Without it, every nested update requires manual spread chains.

**sqlx over rusqlite** — async Rust is Tokio-based; rusqlite is synchronous and requires `spawn_blocking`. sqlx is natively async and integrates cleanly with Tauri's Tokio runtime.

**FFmpeg subprocess (Phase 3)** — bundled FFmpeg binary called via `tauri-plugin-shell`. Avoids linking complexity. Phase 5+ can migrate to native bindings if needed.
