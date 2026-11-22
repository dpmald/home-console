# Offline protocol regression. Only its own temporary encrypted journal is touched.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/Invoke-GroceryCartQueue.ps1') -Action Peek
$journalPath = Join-Path ([IO.Path]::GetTempPath()) ('grocery-queue-test-' + [guid]::NewGuid().ToString('N') + '.dpapi')
$label = 'cart-synthetic'
$id = [guid]::NewGuid().ToString()
$worker = [guid]::NewGuid().ToString()
$claim = [guid]::NewGuid().ToString()
$script:lost = $true
$script:seen = @()
function Invoke-GroceryTool([string]$Name,[hashtable]$Arguments) {
    $op = $Arguments.operation
    $script:seen += (ConvertTo-Json $op -Depth 12 -Compress)
    if ($op.operation_id -eq 'lost' -and $script:lost) { $script:lost = $false; throw 'Simulated lost acknowledgement' }
    if ($op.phase -eq 'complete' -and ($op.worker_token -ne $worker -or $op.claim_token -ne $claim)) { throw 'Missing saved scoped tokens' }
    return [pscustomobject]@{ok=$true; run_id=$label; phase=$op.phase; status='prepared'; retailer='Wegmans'; request_id=$id; revision=1; queue_policy='authorized-revision-v1'
        lease_expires_at=[DateTimeOffset]::UtcNow.AddMinutes(14).ToString('o'); worker_token=$worker; claim_token=$claim }
}
try {
    $intent = @{phase='prepare'; operation_id='new'; request_id=$id; revision=1; retailer='Wegmans';
        observed_cart=@(); quick_add=@{query='Synthetic turkey';quantity=1}; observed_at='2026-11-20T12:34:56.1234567Z'}
    $payload = ConvertTo-Json $intent -Depth 8 -Compress
    $result = Get-ProgressResult $label $payload '' $journalPath
    if ($result.may_add -ne $true -or $result.claim_token -or $result.worker_token) { throw 'Fresh prepare or redaction failed' }
    if ([IO.File]::ReadAllText($journalPath).Contains($worker)) { throw 'Unencrypted journal' }
    if ((Get-ProgressResult $label $payload '' $journalPath).code -ne 'use_retry') { throw 'Duplicate local dispatch' }
    if ((Get-ProgressResult $label '' 'new' $journalPath).may_add) { throw 'Prepare replay allowed another add' }
    $intent.operation_id='lost'
    try { $null=Get-ProgressResult $label (ConvertTo-Json $intent -Depth 8) '' $journalPath; throw 'Expected lost reply' }
    catch { if ($_.Exception.Message -ne 'Simulated lost acknowledgement') { throw } }
    $result = Get-ProgressResult $label '' 'lost' $journalPath
    if ($result.may_add -or $seen[-1] -cne $seen[-2]) { throw 'Lost-ack replay changed payload or allowed an add' }
    $receipt = @{phase='complete'; operation_id='done'; request_id=$id; revision=1; retailer='Wegmans';
        outcome='in_cart'; product=@{product_id='test-1';name='Synthetic turkey';size='16 oz';quantity=1};observed_at=$intent.observed_at}
    $result = Get-ProgressResult $label (ConvertTo-Json $receipt -Depth 8) '' $journalPath
    if (!$result.ok -or $result.may_add -or $result.worker_token -or $result.claim_token) { throw 'Final receipt leaked a token or allowed an add' }
    Write-Output 'PASS encrypted journal, exact replay, uncertain acknowledgement, single-use permit and receipt redaction'
} finally {
    if ([IO.File]::Exists($journalPath)) { [IO.File]::Delete($journalPath) }
}
