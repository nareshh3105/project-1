# Removes what install.ps1 added. Must run as administrator.
$ErrorActionPreference = 'Stop'
$clsid = '{B4D1A2C7-5E3F-4C1A-9D6B-2F7E8A3C1D90}'
Remove-Item -Recurse -Force "HKLM:\Software\Classes\CLSID\$clsid" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $env:ProgramData 'CodeBuilders\vcam') -ErrorAction SilentlyContinue
Write-Host 'removed'
