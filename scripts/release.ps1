# Builds CodeBuilders and archives the installers into versions/v<version>/
#
#   npm run release
#
# Previous versions are never deleted. Re-running for a version that already
# has artifacts refuses to overwrite unless -Force is passed.

param(
    [switch]$Force,
    [switch]$SkipBuild,
    # Some security products hold a lock on files electron-builder extracts
    # under the project tree, which fails the packaging step with EBUSY.
    # Building somewhere they watch less aggressively avoids it.
    # See scripts/PACKAGING.md.
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if (-not $version) { throw 'Could not read version from package.json' }

Write-Host "CodeBuilders v$version" -ForegroundColor Cyan

$destDir = Join-Path $root "versions\v$version"

if ((Test-Path $destDir) -and -not $Force) {
    $existing = Get-ChildItem $destDir -File -Filter '*.exe' -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host ''
        Write-Host "versions\v$version already contains installers." -ForegroundColor Yellow
        Write-Host 'Bump "version" in package.json, or re-run with -Force to overwrite.' -ForegroundColor Yellow
        exit 1
    }
}

$buildRoot = if ($OutDir) { $OutDir } else { Join-Path $root 'release' }
$buildDir  = Join-Path $buildRoot $version

if (-not $SkipBuild) {
    if (-not $env:CSC_LINK) {
        Write-Host ''
        Write-Host 'CSC_LINK is not set — this build will NOT be signed, so Windows' -ForegroundColor Yellow
        Write-Host 'will warn users that the publisher is unknown. See scripts/SIGNING.md.' -ForegroundColor Yellow
    }

    Push-Location $root
    try {
        npx electron-vite build
        if ($LASTEXITCODE -ne 0) { throw "electron-vite build failed ($LASTEXITCODE)" }

        $args = @()
        if ($OutDir) { $args += "-c.directories.output=$buildRoot/`${version}" }
        npx electron-builder @args
        if ($LASTEXITCODE -ne 0) { throw "electron-builder failed ($LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
}

# Match the artifacts for THIS version explicitly. Earlier builds are left in
# the output directory, so taking the first match could archive a stale
# installer under the new version number.
$exe = Get-ChildItem $buildDir -Filter "*$version*.exe" -ErrorAction SilentlyContinue |
       Where-Object { $_.Name -notmatch 'uninstall' } | Select-Object -First 1
$msi = Get-ChildItem $buildDir -Filter "*$version*.msi" -ErrorAction SilentlyContinue |
       Select-Object -First 1

if (-not $exe -and -not $msi) {
    throw "No installers matching version $version found under $buildDir"
}

New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$copied = @()
foreach ($f in @($exe, $msi)) {
    if ($f) {
        Copy-Item $f.FullName -Destination $destDir -Force
        $copied += [pscustomobject]@{
            File   = $f.Name
            SizeMB = [math]::Round($f.Length / 1MB, 1)
        }
    }
}

[pscustomobject]@{
    version   = $version
    builtAt   = (Get-Date).ToString('o')
    gitCommit = (& git -C $root rev-parse --short HEAD 2>$null)
    runtime   = 'electron'
    signed    = [bool]$env:CSC_LINK
    artifacts = $copied
} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $destDir 'build-info.json') -Encoding utf8

Write-Host "`nArchived to versions\v$version" -ForegroundColor Green
$copied | Format-Table -AutoSize

Write-Host 'All versions:' -ForegroundColor Cyan
Get-ChildItem (Join-Path $root 'versions') -Directory |
    Sort-Object Name |
    ForEach-Object { Write-Host "  $($_.Name)" }
