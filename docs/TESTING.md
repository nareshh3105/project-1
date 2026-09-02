# Testing

```bash
npm test              # watch mode
npm run test:run      # single run
npm run test:coverage # single run with coverage
```

Vitest runs in Node by default, since most of what is worth testing is
main-process logic. A renderer suite opts into a DOM with a docblock on the
first line:

```ts
// @vitest-environment jsdom
```

`electron` is aliased to `test/mocks/electron.ts`, so main-process code can be
imported without launching an Electron host. App paths in the mock point at an
OS temp directory.

Most suites reset the module registry in `beforeEach`. The command registry and
the database handle both live in module scope, so without a reset one test's
registrations leak into the next.

## What is covered

316 tests. Priority went to the layers where a defect is silent rather than
loud: schema and cascade behaviour, the IPC boundary every renderer call
crosses, ffmpeg process handling and argument construction, and persistence.

| Area | Statements |
|---|---|
| `electron/main` (`ipc.ts`) | 100% |
| `electron/main/db` | 100% |
| `electron/main/output` | 98% |
| `electron/main/commands` | 64% |
| `src/lib` | 72% |
| `src/stores` | 38% |
| `src/components` | 2 of ~40 components |
| `electron/main/diagnostics` | high |
| **Backend overall** | **meets the 70% NF-13 commits to** |

`child_process` is mocked (`test/mocks/child-process.ts`), so the recording,
streaming, replay and virtual camera paths are exercised without spawning
ffmpeg: argument construction, event emission, refusal to start twice, and
failure reporting when ffmpeg exits during startup.

Those suites use fake timers. Every start awaits a grace window to catch an
immediate ffmpeg failure, and waiting those out for real took eighty seconds
across the file; on a fake clock the same suite runs in under one.

## Component tests

`test/mocks/bridge.ts` stands in for the preload's contextBridge, so a
component can be rendered and driven without an Electron host. It records
which commands were invoked, lets a test queue a result or a failure, and
can push a backend event at whatever the interface subscribed with.

Interactions go through a small `click` helper that wraps the event in
`act`. The handlers set state after an awaited IPC call, which otherwise
lands outside the act scope userEvent establishes and makes React warn.

Two components are covered so far: `ControlsPanel`, where FFmpeg's absence
has to disable the right things and explain why, and `FfmpegMissingModal`,
which is the only thing telling a user why recording does not work.

## What is not covered

- `commands/audio.ts`, `stats.ts`, `screenshot.ts`, `hotkeys.ts`,
  `updater.ts`, `window.ts` — thin wrappers over Electron APIs
- `sceneStore`, `sourceStore`, `collectionStore`, `captureStore`,
  `transitionStore`, `hotkeyStore` — these call through to IPC, so they need
  the bridge stubbed before they can be driven
- Roughly 38 of the 40 React components

Renderer coverage reads about 19%, down from the 42% reported before
components were measured at all. Nothing regressed — the scope widened, and
the lower number is the honest one.

## Coverage thresholds

Two gates, for two different purposes:

`electron/main/**` is held at **70%**, which is what NF-13 in the SRS commits
the backend process to. It passes today.

Everything else carries a **ratchet** set just under what is currently
achieved. That exists to stop coverage regressing, not to claim a target has
been met. Raise it as renderer suites are added.

Scoping the backend separately matters: a single blended number would let
well-covered backend code disguise the untested renderer, and would read as
though NF-13 were met when it might not be.

## Regression guards

Two tests exist because the corresponding bug shipped:

**Cascade deletes** (`db.test.ts`). In the Rust build the `foreign_keys` pragma
was issued once against a connection pool, so most connections ran without it
and `ON DELETE CASCADE` silently never fired. Deleting a collection stranded its
scenes; deleting a scene stranded its sources. Seven orphaned rows were found on
a developer machine.

Note that better-sqlite3 enables foreign keys per connection by default, so
these tests would not fail merely from deleting the explicit pragma. What they
guard is the property — that cascades fire — which is what a driver change or a
stray `foreign_keys = OFF` would break.

**Profile capture** (`settings.test.ts`). `captureSettings()` built a
`SettingsState` without the `recording` section, so switching profiles would
have dropped the user's output format and audio track selection. TypeScript
caught it before release; the test now catches it at runtime too.

## Writing a new suite

Verify a new test can fail. Break the code it covers, confirm a red run, then
restore. A test that passes against a deliberately broken implementation is
worse than no test, because it implies coverage that does not exist.

Both regression guards above were validated this way: reintroducing the profile
defect failed two tests, and an off-by-one in the ffmpeg stream index failed two
more. Removing streamkey from the redaction list failed five, one of them
asserting the key never reaches the log file.

Some conditions cannot be reproduced under jsdom. The FfmpegMissingModal suite
checks that aria-hidden is cleared from the page after the dialog closes, but
that assertion passes against the old buggy code too, because React still runs
effect cleanups when a component returns null. The failure it describes was
real, and was observed in a browser. The test says so rather than implying a
guarantee it does not provide.
