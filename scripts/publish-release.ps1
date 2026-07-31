# Publishes versions/v<version>/ to GitHub Releases and generates the
# latest.json manifest that the in-app updater polls.
#
#   npm run publish
#
# Requires the GitHub CLI (winget install GitHub.cli) and `gh auth login`.
# Run scripts/release.ps1 first so the artifacts exist.

param(
    [switch]$Draft,
    [string]$Notes = ''
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$conf = Join-Path $root 'src-tauri\tauri.conf.json'
$confJson = Get-Content $conf -Raw | ConvertFrom-Json
$version  = $confJson.version
$tag      = "v$version"
$dir      = Join-Path $root "versions\$tag"

if (-not (Test-Path $dir)) { throw "$dir not found - run 'npm run release' first." }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI not found. Install with: winget install GitHub.cli   then: gh auth login"
}

$exe = Get-ChildItem $dir -Filter '*-setup.exe' | Select-Object -First 1
$msi = Get-ChildItem $dir -Filter '*.msi'       | Select-Object -First 1
if (-not $exe) { throw "No NSIS installer found in $dir" }

# The updater verifies this signature against the pubkey compiled into the app.
$sigFile = Join-Path $dir "$($exe.Name).sig"
if (-not (Test-Path $sigFile)) {
    throw @"
No signature file next to $($exe.Name).

That build was unsigned, so the updater would reject it. Set the signing
env vars and rebuild - see scripts/SIGNING.md.
"@
}
if (-not $confJson.plugins.updater.pubkey) {
    throw "tauri.conf.json has an empty updater pubkey - the app cannot verify any update."
}

$signature = (Get-Content $sigFile -Raw).Trim()
$repo = (& git -C $root remote get-url origin) -replace '^.*github\.com[:/]', '' -replace '\.git$', ''

$latest = [ordered]@{
    version   = $version
    notes     = if ($Notes) { $Notes } else { "CodeBuilders $version" }
    pub_date  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    platforms = [ordered]@{
        'windows-x86_64' = [ordered]@{
            signature = $signature
            url       = "https://github.com/$repo/releases/download/$tag/$($exe.Name)"
        }
    }
}

$latestPath = Join-Path $dir 'latest.json'
$latest | ConvertTo-Json -Depth 5 | Set-Content $latestPath -Encoding utf8
Write-Host "Wrote $latestPath" -ForegroundColor Green

$assets = @($exe.FullName, $latestPath)
if ($msi) { $assets += $msi.FullName }

Write-Host "`nPublishing $tag to $repo ..." -ForegroundColor Cyan

$ghArgs = @('release', 'create', $tag) + $assets +
          @('--title', "CodeBuilders $version", '--notes', $latest.notes)
if ($Draft) { $ghArgs += '--draft' }

& gh @ghArgs
if ($LASTEXITCODE -ne 0) { throw "gh release create failed ($LASTEXITCODE)" }

Write-Host "`nPublished: https://github.com/$repo/releases/tag/$tag" -ForegroundColor Green
Write-Host "Updater endpoint serves latest.json from the 'latest' release." -ForegroundColor Gray
