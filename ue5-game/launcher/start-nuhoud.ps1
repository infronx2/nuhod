# Starts a Nuhoud session on this computer: the pose server (if it is not running yet), then the
# majlis game. When the game closes, a pose server this script started is stopped again.
# The website's "Start session" button runs this through nuhoud:// links (see register-protocol.ps1).
param(
  [string]$Uri = '',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

# Where the game and the engine live on this computer.
$GameDir = 'D:\gamez\Nuhoud'
$Editor = 'D:\un\UE_5.5\Engine\Binaries\Win64\UnrealEditor.exe'
$Health = 'http://127.0.0.1:8001/health'

function Test-PoseServer {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $Health).StatusCode -eq 200 } catch { return $false }
}

foreach ($path in @("$GameDir\pose_server.py", "$GameDir\Nuhoud.uproject", $Editor)) {
  if (-not (Test-Path $path)) { throw "Not found: $path (edit the paths at the top of $PSCommandPath)" }
}

$running = Test-PoseServer
if ($DryRun) {
  "pose server running: $running"
  "would start: python `"$GameDir\pose_server.py`"" + $(if ($running) { ' (skipped, already running)' } else { '' })
  "would start: `"$Editor`" `"$GameDir\Nuhoud.uproject`" -game -windowed -resx=1600 -resy=900"
  return
}

$poseServer = $null
if (-not $running) {
  $poseServer = Start-Process -FilePath python -ArgumentList "`"$GameDir\pose_server.py`"" -WorkingDirectory $GameDir -WindowStyle Minimized -PassThru
  for ($i = 0; $i -lt 40 -and -not (Test-PoseServer); $i++) { Start-Sleep -Milliseconds 500 }
}

$game = Start-Process -FilePath $Editor -ArgumentList @("`"$GameDir\Nuhoud.uproject`"", '-game', '-windowed', '-resx=1600', '-resy=900') -PassThru
$game.WaitForExit()

if ($poseServer -and -not $poseServer.HasExited) {
  Stop-Process -Id $poseServer.Id
}
