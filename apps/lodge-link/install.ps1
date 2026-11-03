# NetFlex lodge link: install as a Windows task that starts with the computer.
# Run in PowerShell as Administrator, from this folder:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js is not installed. Install the LTS version from https://nodejs.org, then run this again.' }
$major = [int]((& $node --version).TrimStart('v').Split('.')[0])
if ($major -lt 20) { throw "Node.js $major is too old; install the LTS version from https://nodejs.org." }
$config = Join-Path $here 'lodge-link.json'
if (-not (Test-Path $config)) { throw 'Run "node lodge-link.mjs setup" and "node lodge-link.mjs pair CODE" first.' }

# Only Administrators and the system account may read the settings (they hold passwords).
icacls $config /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F' | Out-Null

$name = 'NetFlex Lodge Link'
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$here\lodge-link.mjs`" run" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
Start-ScheduledTask -TaskName $name
Write-Host "Installed and started '$name'. It starts by itself whenever the computer turns on."
Write-Host "Log: $here\lodge-link.log"
