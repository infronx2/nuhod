# Lets the website's "Start session" button open Nuhoud on this computer: registers nuhoud:// links
# for the current Windows user to run start-nuhoud.ps1 (no admin rights needed).
#   powershell -ExecutionPolicy Bypass -File register-protocol.ps1          # register
#   powershell -ExecutionPolicy Bypass -File register-protocol.ps1 -Remove  # undo
param([switch]$Remove)
$ErrorActionPreference = 'Stop'

$key = 'HKCU:\Software\Classes\nuhoud'
if ($Remove) {
  if (Test-Path $key) { Remove-Item -Path $key -Recurse }
  'nuhoud:// links removed'
  return
}

$launcher = Join-Path $PSScriptRoot 'start-nuhoud.ps1'
New-Item -Path $key -Force | Out-Null
Set-ItemProperty -Path $key -Name '(Default)' -Value 'URL:Nuhoud'
Set-ItemProperty -Path $key -Name 'URL Protocol' -Value ''
New-Item -Path "$key\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$key\shell\open\command" -Name '(Default)' `
  -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" `"%1`""
"nuhoud:// links now run $launcher"
