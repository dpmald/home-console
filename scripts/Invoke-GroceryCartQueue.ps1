#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('Peek','List','Progress','Retry')][string]$Action,
    [ValidatePattern('^(cart|manual)-[A-Za-z0-9_-]{1,64}$')][string]$RunId,
    [string]$InputJson,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$')][string]$OperationId
)

function Read-ProtectedText([string]$Path) {
    $secure = ConvertTo-SecureString ([IO.File]::ReadAllText($Path).Trim())
    return ([pscredential]::new('grocery', $secure)).GetNetworkCredential().Password
}

function ConvertFrom-QueueJson([string]$Text) {
    # Preserve UTC offsets and the original JSON on PowerShell versions that parse dates automatically.
    if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) {
        return ConvertFrom-Json -InputObject $Text -DateKind String
    }
    return ConvertFrom-Json -InputObject $Text
}

function Save-RunJournal($Journal, [string]$Path) {
    $text = ConvertTo-Json -InputObject $Journal -Depth 24 -Compress
    $sealed = ConvertFrom-SecureString (ConvertTo-SecureString $text -AsPlainText -Force)
    $temporary = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($temporary, $sealed)
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $Path) }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

function Invoke-GroceryTool([string]$Name, [hashtable]$Arguments) {
    $call = @{jsonrpc='2.0'; id=1; method='tools/call'; params=@{name=$Name; arguments=$Arguments}}
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, 'https://home-console-beta.vercel.app/api/mcp')
    try {
        $request.Headers.Add('Authorization', ('Bearer ' + $script:connectorKey))
        $request.Headers.Add('Accept','application/json, text/event-stream')
        $request.Content = [Net.Http.StringContent]::new((ConvertTo-Json $call -Depth 24 -Compress), [Text.Encoding]::UTF8, 'application/json')
        $response = $script:client.SendAsync($request).GetAwaiter().GetResult()
        try {
            if (!$response.IsSuccessStatusCode) { throw 'Connector request failed.' }
            $rpc = ConvertFrom-QueueJson ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult())
            if ($rpc.error -or $rpc.id -ne 1 -or $rpc.result.structuredContent.ok -isnot [bool]) {
                throw 'Invalid MCP result or arguments.'
            }
            return $rpc.result.structuredContent
        } finally { $response.Dispose() }
    } finally { $request.Dispose() }
}

function Get-ProgressResult([string]$Label, [string]$Data, [string]$RetryId, [string]$Path) {
    if ([IO.File]::Exists($Path)) { $journal = ConvertFrom-QueueJson (Read-ProtectedText $Path) }
    else { $journal = [pscustomobject]@{ run_id=$Label; worker=$null; claims=[pscustomobject]@{}; operations=[pscustomobject]@{} } }
    if ($journal.run_id -cne $Label) { throw 'Journal belongs to a different run.' }
    if ($RetryId) {
        $entry = $journal.operations.PSObject.Properties[$RetryId]
        if (!$entry) { throw 'Unknown operation ID.' }
        $op = $entry.Value
    } else {
        $op = ConvertFrom-QueueJson $Data
        $opId = [string]$op.operation_id
        if ($opId -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$' -or $op.request_id -notmatch '^[0-9a-f-]{36}$' -or
            $op.phase -cnotin 'prepare','complete' -or [int]$op.revision -lt 1) { throw 'Invalid operation.' }
        foreach ($reserved in 'claim_token','worker_token','run_id') {
            if ($op.PSObject.Properties[$reserved]) { throw 'Supply run_id on the command line. The journal supplies scoped tokens.' }
        }
        if ($journal.operations.PSObject.Properties[$opId]) {
            return [pscustomobject]@{ok=$false;code='use_retry';operation_id=$opId;may_add=$false}
        }
        $op | Add-Member NoteProperty run_id $Label
        $claimId = "$($op.request_id)/$($op.revision)"
        if ($op.phase -eq 'prepare' -and $journal.worker) {
            $op | Add-Member NoteProperty worker_token $journal.worker
        } elseif ($op.phase -eq 'complete' -and $journal.claims.PSObject.Properties[$claimId]) {
            $op | Add-Member NoteProperty worker_token $journal.worker
            $op | Add-Member NoteProperty claim_token $journal.claims.PSObject.Properties[$claimId].Value
        }
        $journal.operations | Add-Member NoteProperty $opId $op
        # Persist the exact operation before dispatch so a lost reply can be replayed.
        Save-RunJournal $journal $Path
    }
    $reply = Invoke-GroceryTool 'record_request_progress' @{operation=$op}
    $permit = $false
    if ($reply.ok -and $op.phase -eq 'prepare') {
        if (!$reply.worker_token -or !$reply.claim_token -or $reply.request_id -ne $op.request_id -or $reply.run_id -cne $Label -or
            $reply.phase -cne 'prepare' -or $reply.status -cne 'prepared' -or $reply.retailer -cne $op.retailer -or
            $reply.revision -ne $op.revision -or !$reply.lease_expires_at) { throw 'Invalid prepare reply.' }
        $journal.worker = $reply.worker_token
        $journal.claims | Add-Member NoteProperty "$($op.request_id)/$($op.revision)" $reply.claim_token -Force
        Save-RunJournal $journal $Path
        $permit = !$RetryId -and !$reply.replayed -and ([DateTimeOffset]::Parse($reply.lease_expires_at) -gt [DateTimeOffset]::UtcNow)
        $permit = $permit -and $reply.queue_policy -ceq 'authorized-revision-v1'
    }
    $reply.PSObject.Properties.Remove('worker_token')
    $reply.PSObject.Properties.Remove('claim_token')
    $reply | Add-Member NoteProperty may_add ([bool]$permit) -Force
    return $reply
}

if ($MyInvocation.InvocationName -eq '.') { return } # Run protocol regressions with an isolated transport.
$ErrorActionPreference = 'Stop'
$client = $null
$lock = $null
try {
    Add-Type -AssemblyName System.Net.Http
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(20)
    if ($Action -eq 'Peek') {
        $display = $client.GetStringAsync('https://home-console-beta.vercel.app/api/groceries').GetAwaiter().GetResult() | ConvertFrom-Json
        if ($display.ok -ne $true -or $display.items -isnot [array]) { throw 'Invalid display response.' }
        # A public row is a wake-up hint only. Eligibility comes from the protected cart snapshot.
        $waiting = @($display.items | Where-Object {
            ($_.status -eq 'needed' -and $null -ne $_.cart_authorized_revision -and $_.cart_authorized_revision -eq $_.revision) -or
            ($_.status -ne 'needs_attention' -and $_.result.requires_reconciliation)
        })
        $result = @{ok=$true; candidate_count=$waiting.Count}
    } else {
        if ($RunId -cnotmatch '^(cart|manual)-[A-Za-z0-9_-]{1,64}$') { throw 'A cart or manual run ID is required.' }
        $base = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'HomeConsole'
        $connectorKey = Read-ProtectedText (Join-Path $base 'HostedBeta\connector.dpapi')
        if ($Action -eq 'List') {
            $result = Invoke-GroceryTool 'list_pending' @{run_id=$RunId}
            if ($RunId.StartsWith('cart-') -and $result.ok -and $result.queue_policy -cne 'authorized-revision-v1') {
                $result = @{ok=$false; code='trusted_queue_unavailable'}
            }
        } else {
            if ($Action -eq 'Progress' -and !$InputJson -and [Console]::IsInputRedirected) { $InputJson = [Console]::In.ReadToEnd() }
            if (($Action -eq 'Progress' -and (!$InputJson -or $OperationId)) -or ($Action -eq 'Retry' -and (!$OperationId -or $InputJson))) {
                throw 'Progress needs JSON; Retry needs only the original operation ID.'
            }
            $stateDir = Join-Path $base 'GroceryCartWorker\runs'
            $null = [IO.Directory]::CreateDirectory($stateDir)
            $path = Join-Path $stateDir ($RunId + '.dpapi')
            $lock = [IO.File]::Open(($path+'.lock'), 'OpenOrCreate','ReadWrite','None')
            $result = Get-ProgressResult $RunId $InputJson $OperationId $path
        }
    }
    ConvertTo-Json -InputObject $result -Depth 24 -Compress
    if (!$result.ok) { exit 2 }
} catch {
    # Exceptions can include arguments from the server or the local credential reader.
    [Console]::Error.WriteLine('Home Console queue command failed. For an uncertain Progress operation, use Retry with its original run ID and operation ID; reconcile before any cart edit.')
    exit 1
} finally {
    if ($null -ne $lock) { $lock.Dispose() }
    if ($null -ne $client) { $client.Dispose() }
}
