$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskExtension = Join-Path $taskRoot 'extension'
$taskVersion = (Get-Content -Raw -LiteralPath (Join-Path $taskExtension 'manifest.json') | ConvertFrom-Json).version
$taskDist = Join-Path $taskRoot 'dist'
New-Item -ItemType Directory -Path $taskDist -Force | Out-Null
$taskZip = Join-Path $taskDist "GofileSafeViewerPC-v$taskVersion.zip"
# Package only extension files. Tests, profiles, notes and screenshots stay local.
Compress-Archive -Path (Join-Path $taskExtension '*') -DestinationPath $taskZip -Force
$taskHash = (Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$taskZip.sha256" -Value "$taskHash  $([System.IO.Path]::GetFileName($taskZip))" -Encoding ascii
Get-Item -LiteralPath $taskZip | Select-Object FullName, Length
