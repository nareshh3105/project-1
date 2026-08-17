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

| Area | Coverage |
|---|---|
| `db/index.ts`, `db/mappers.ts` | 100% |
| `ipc.ts` | 100% |
| `commands/scenes.ts` | 100% |
| `commands/collections.ts` | 100% |
| `commands/sources.ts` | 93% |
| `commands/plugins.ts` | high |
| `output/args.ts` | 100% |

105 tests. Priority went to the layers where a defect is silent: schema and
cascade behaviour, the IPC boundary every renderer call crosses, ffmpeg
argument construction, and settings persistence.

## What is not covered

Everything that spawns a process or drives an OS surface:

- `output/ffmpeg.ts` and `commands/output.ts` — recording, streaming, replay,
  virtual camera. The argument construction is extracted into `output/args.ts`
  and fully covered; what remains is process lifecycle.
- `commands/screenshot.ts`, `stats.ts`, `audio.ts`, `hotkeys.ts`,
  `updater.ts`, `window.ts`
- Most renderer stores, and every React component

Overall statement coverage is around 28%, against the 70% that NF-13 in the SRS
commits to for the backend. Closing that gap means testing the process-spawning
modules with a mocked `child_process`, and adding component tests. That work is
not done.

## Coverage thresholds are a ratchet

The thresholds in `vitest.config.ts` sit just below what is currently achieved.
They exist to stop coverage regressing, not to claim a target has been met.
Raise them as suites are added.

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
more.
