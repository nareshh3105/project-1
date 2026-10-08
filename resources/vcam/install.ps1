# Installs the virtual camera for all users. Must run as administrator.
#
#   - copies the camera DLL to C:\ProgramData\CodeBuilders\vcam, under a name that
#     carries its version, so that an update never meets the old file still in use
#   - registers its class under HKLM\Software\Classes\CLSID
#
# Windows loads camera sources in a system service, which cannot see a per-user
# registration or a DLL inside a user's profile.
param([Parameter(Mandatory)][string]$Dll)

$ErrorActionPreference = 'Stop'
$clsid = '{B4D1A2C7-5E3F-4C1A-9D6B-2F7E8A3C1D90}'
$dir = Join-Path $env:ProgramData 'CodeBuilders\vcam'

$hash = (Get-FileHash $Dll -Algorithm SHA256).Hash.Substring(0, 12).ToLower()
$target = Join-Path $dir "CodeBuildersCamera-$hash.dll"

New-Item -ItemType Directory -Force $dir | Out-Null
if (-not (Test-Path $target)) { Copy-Item -Force $Dll $target }

$key = "HKLM:\Software\Classes\CLSID\$clsid"
$previous = $null
try { $previous = (Get-ItemProperty "$key\InprocServer32" -ErrorAction Stop).'(default)' } catch { }
New-Item -Force $key | Out-Null
Set-ItemProperty $key -Name '(default)' -Value 'CodeBuilders Virtual Camera'
New-Item -Force "$key\InprocServer32" | Out-Null
Set-ItemProperty "$key\InprocServer32" -Name '(default)' -Value $target
Set-ItemProperty "$key\InprocServer32" -Name 'ThreadingModel' -Value 'Both'

# Windows keeps the camera it loaded first until its camera service restarts, so an
# update does nothing until then. Only done when a different version was installed.
if ($previous -and $previous -ne $target) {
  try { Restart-Service FrameServer -Force -ErrorAction Stop } catch { }
}

# Older copies, where Windows is no longer holding them.
Get-ChildItem $dir -Filter 'CodeBuildersCamera*.dll' | Where-Object { $_.FullName -ne $target } |
  ForEach-Object { try { Remove-Item -Force $_.FullName } catch { } }

Write-Host "installed $target"
