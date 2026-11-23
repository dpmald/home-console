# The worker exchanges UTF-8 JSON on standard input and output.
param([string]$Action, [string]$RunId, [string]$OperationId)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
& (Join-Path $PSScriptRoot 'Invoke-GroceryCartQueue.ps1') @PSBoundParameters
exit $LASTEXITCODE
