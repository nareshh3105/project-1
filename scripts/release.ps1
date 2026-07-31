# Builds CodeBuilders and archives the installers into versions/v<version>/
#
#   npm run release
#
# Previous versions are never deleted. Re-running for a version that already
# exists refuses to overwrite unless -Force is passed.

param(
    [switch]$Force,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$conf = Join-Path $root 'src-tauri\tauri.conf.json'

$version = (Get-Content $conf -Raw | ConvertFrom-Json).version
if (-not $version) { throw "Could not read version from $conf" }

Write-Host "CodeBuilders v$version" -ForegroundColor Cyan

$destDir = Join-Path $root "versions\v$version"

if ((Test-Path $destDir) -and -not $Force) {
    $existing = Get-ChildItem $destDir -File -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host ""
        Write-Host "versions\v$version already exists with $($existing.Count) file(s)." -ForegroundColor Yellow
        Write-Host "Bump the version in src-tauri/tauri.conf.json, package.json and" -ForegroundColor Yellow
        Write-Host "src-tauri/Cargo.toml - or re-run with -Force to overwrite." -ForegroundColor Yellow
        exit 1
    }
}

if (-not $SkipBuild) {
    if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
        Write-Host "`nTAURI_SIGNING_PRIVATE_KEY is not set - this build will NOT be signed," -ForegroundColor Yellow
        Write-Host "so the in-app updater cannot verify it. See scripts/SIGNING.md." -ForegroundColor Yellow
    }
    Write-Host "`nBuilding release bundle..." -ForegroundColor Cyan
    # Cap parallel rustc processes; the full-parallelism release build OOMs.
    $env:CARGO_BUILD_JOBS = '2'
    Push-Location $root
    try {
        npm run tauri build
        if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

$bundle = Join-Path $root 'src-tauri\target\release\bundle'

# Match the artifact for THIS version explicitly. Older builds are left in the
# bundle directory by cargo, so picking the first match would archive a stale
# installer under the new version number.
$msi = Get-ChildItem (Join-Path $bundle 'msi')  -Filter "*$version*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
$exe = Get-ChildItem (Join-Path $bundle 'nsis') -Filter "*$version*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $msi -and -not $exe) {
    throw "No installers matching version $version found under $bundle"
}

New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$copied = @()
foreach ($f in @($msi, $exe)) {
    if ($f) {
        Copy-Item $f.FullName -Destination $destDir -Force
        $copied += [pscustomobject]@{
            File   = $f.Name
            SizeMB = [math]::Round($f.Length / 1MB, 1)
        }
        # Updater signature, present only when the build was signed
        $sig = "$($f.FullName).sig"
        if (Test-Path $sig) {
            Copy-Item $sig -Destination $destDir -Force
            $copied += [pscustomobject]@{ File = "$($f.Name).sig"; SizeMB = 0 }
        }
    }
}

# Per-version build metadata
[pscustomobject]@{
    version   = $version
    builtAt   = (Get-Date).ToString('o')
    gitCommit = (& git -C $root rev-parse --short HEAD 2>$null)
    artifacts = $copied
} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $destDir 'build-info.json') -Encoding utf8

Write-Host "`nArchived to versions\v$version" -ForegroundColor Green
$copied | Format-Table -AutoSize

Write-Host "All versions:" -ForegroundColor Cyan
Get-ChildItem (Join-Path $root 'versions') -Directory |
    Sort-Object Name |
    ForEach-Object { Write-Host "  $($_.Name)" }
