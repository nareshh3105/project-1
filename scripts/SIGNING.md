# Update signing

The in-app updater only installs an update whose signature verifies against the
public key compiled into the app. That means:

- The **public key** lives in `src-tauri/tauri.conf.json` and is committed.
- The **private key** signs each release. It must never enter the repo.

> **Back up the private key and its password.**
> They are the only way to ship an update to an already-installed app. Lose them
> and every existing install is stranded — the only recovery is asking each user
> to download and reinstall manually. Changing the key does not help, because
> installed apps only trust the key they were built with.

## One-time setup

### 1. Generate the keypair

Run this yourself — it prompts for a password, so it can't be automated here:

```bash
npm run tauri signer generate -- -w "$env:USERPROFILE\.tauri\codebuilders.key"
```

Choose a strong password and store both the password and
`%USERPROFILE%\.tauri\codebuilders.key` in a password manager.

The command prints the public key and also writes it to
`%USERPROFILE%\.tauri\codebuilders.key.pub`.

### 2. Add the public key to the app

Paste it into `src-tauri/tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "endpoints": ["https://github.com/<owner>/<repo>/releases/latest/download/latest.json"],
    "pubkey": "<contents of codebuilders.key.pub>"
  }
}
```

Commit this. It is a public key — safe to publish.

## Building a signed release

Set both variables in the shell you build from. `TAURI_SIGNING_PRIVATE_KEY`
takes the key file's **contents**, not its path:

```bash
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\codebuilders.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText
npm run release
```

A signed build emits a `.sig` next to each installer; `release.ps1` copies those
into `versions/v<version>/`. `release.ps1` warns when the signing key is absent,
and `publish-release.ps1` refuses to publish an unsigned build.

Do not put these variables in `.env`, a script, or anything committed.

## Publishing

```bash
npm run publish
```

Requires the GitHub CLI:

```bash
winget install GitHub.cli
```

then `gh auth login`. The script generates `latest.json` (version, timestamp,
signature, download URL), creates the GitHub Release, and uploads the installers
alongside it. The updater endpoint reads `latest.json` from the newest release.

Pass `-Draft` to stage a release without publishing it.

## Verifying the update flow

The updater compares against the **installed** app's version, so testing it takes
two builds:

1. Build and publish version N.
2. Install version N from `versions/vN/`.
3. Bump to N+1, then `npm run release` and `npm run publish`.
4. Open the installed version N and choose **Help → Check for Updates**.

Checking for updates from a dev build does nothing useful — the updater plugin
needs the packaged app.
