#requires -Version 5.1
[CmdletBinding()]
param([string]$QueueHelper = (Join-Path (Split-Path $PSScriptRoot) 'Invoke-GroceryCartQueue.ps1'))
$ErrorActionPreference = 'Stop'
$target = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'HomeConsole\GroceryCartWorker'
$null = New-Item -Path $target -ItemType Directory -Force
$python = (Get-Command pythonw.exe -ErrorAction Stop).Source
if (!(Test-Path -LiteralPath $QueueHelper -PathType Leaf)) { throw 'Supply the approved queue helper path.' }
foreach ($file in 'grocery_worker.py','provider.py','Read-QueueUtf8.ps1') {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $target $file) -Force
}
Copy-Item -LiteralPath $QueueHelper -Destination (Join-Path $target 'Invoke-GroceryCartQueue.ps1') -Force
$name = 'HomeConsole-GroceryCartPoller'
$action = New-ScheduledTaskAction -Execute $python -Argument ('-B "' + (Join-Path $target 'grocery_worker.py') + '"') -WorkingDirectory $target
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 2)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$null = Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
Start-ScheduledTask -TaskName $name
[pscustomobject]@{Task=$name; IntervalMinutes=2; WritesEnabled=(Test-Path -LiteralPath (Join-Path $target 'enabled'))}
