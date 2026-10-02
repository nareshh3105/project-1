# Puts ffmpeg.exe (and its licence) into resources/ffmpeg so the installer ships
# with it. The binary is not kept in git.
#
#   npm run fetch-ffmpeg
#
# Uses the "essentials" Windows build from gyan.dev. Re-running does nothing if
# the binary is already there; pass -Force to download it again.
#
# LICENCE: that build is GPL v3. Shipping it to people outside the team means
# meeting the GPL's obligations (licence text with the app, and an offer of the
# corresponding source). The LICENSE file is copied alongside the binary for
# that reason. Decide this before any public release; see DC-16 in docs/SRS.md.

param(
    [switch]$Force,
    # Copy an FFmpeg you already have instead of downloading one.
    [string]$From
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'resources\ffmpeg'
$exe  = Join-Path $dest 'ffmpeg.exe'

if ((Test-Path $exe) -and -not $Force) {
    Write-Host "ffmpeg.exe already present ($([math]::Round((Get-Item $exe).Length / 1MB)) MB). Use -Force to replace it." -ForegroundColor Green
    exit 0
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null

if ($From) {
    if (-not (Test-Path $From)) { throw "Not found: $From" }
    Copy-Item $From $exe -Force
    Write-Host "Copied $From" -ForegroundColor Cyan

    # Builds unpack as <root>\bin\ffmpeg.exe with LICENSE in <root>. Ship it too:
    # the GPL requires the licence text to travel with the binary.
    $fromDir = Split-Path -Parent (Resolve-Path $From)
    $licence = @($fromDir, (Split-Path -Parent $fromDir)) |
        ForEach-Object { Get-ChildItem $_ -Filter 'LICENSE*' -File -ErrorAction SilentlyContinue } |
        Select-Object -First 1
    if ($licence) { Copy-Item $licence.FullName (Join-Path $dest 'LICENSE.txt') -Force }
    else { Write-Host 'No LICENSE file found beside it; add one to resources\ffmpeg before distributing.' -ForegroundColor Yellow }
} else {
    $url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
    $tmp = Join-Path ([IO.Path]::GetTempPath()) "ffmpeg-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $zip = Join-Path $tmp 'ffmpeg.zip'

    try {
        Write-Host "Downloading $url" -ForegroundColor Cyan
        # Retry: a large download over a flaky connection is the usual failure.
        $attempt = 0
        while ($true) {
            try {
                $attempt++
                Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
                break
            } catch {
                if ($attempt -ge 3) { throw }
                Write-Host "  attempt $attempt failed, retrying..." -ForegroundColor Yellow
                Start-Sleep -Seconds 3
            }
        }

        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        $found = Get-ChildItem $tmp -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
        if (-not $found) { throw 'ffmpeg.exe was not in the downloaded archive' }
        Copy-Item $found.FullName $exe -Force

        $licence = Get-ChildItem $tmp -Recurse -Filter 'LICENSE*' | Select-Object -First 1
        if ($licence) { Copy-Item $licence.FullName (Join-Path $dest 'LICENSE.txt') -Force }
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Refuse to leave a file that does not actually run.
# Read all of the output before trimming it. Piping straight into
# Select-Object -First 1 closes the pipe early, which makes ffmpeg exit
# non-zero and turns a working binary into a false failure.
$output = & $exe -version 2>&1
if ($LASTEXITCODE -ne 0) { throw "The copied ffmpeg.exe does not run: $($output | Select-Object -First 1)" }
$version = $output | Select-Object -First 1

Write-Host "Ready: $version" -ForegroundColor Green
