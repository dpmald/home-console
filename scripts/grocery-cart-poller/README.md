# Windows grocery cart worker

This worker polls the protected Home Console queue every two minutes under the signed-in Windows user. The queue returns only authenticated, authorized grocery revisions. Production and Beta must share the queue or forward trusted writes into it. Use [the protected queue helper](../Invoke-GroceryCartQueue.ps1) with the approved cart-only migration and its Windows user credential.

The worker uses the user's existing Instacart connection through the [public Codex App Server API](https://developers.openai.com/codex/app-server/). It starts an ephemeral local CLI session only when an eligible row is ready. The worker calls the documented cart and product-search tools. Its code constructs provider arguments from structured grocery fields. It can quick-add an ordinary product or increase the quantity of a product that matches a requested size. Checkout remains a household action.

The household's retailer rule selects Wegmans when its itemized cart has items and Morton Williams Supermarket when Wegmans is empty. The account controls whether that retailer cart is a family cart. The connector returns the retailer and its itemized contents. Each accepted revision contributes its own package count once. If the provider cannot confirm the operation or the resulting product, the kiosk shows **Needs attention**. A new revision on the console lets the household provide a more specific request.

## Install and run

From an interactive PowerShell 7 session on the signed-in computer, run the following after installing the Codex CLI, signing into ChatGPT, connecting Instacart, and provisioning the approved Home Console queue helper.

```powershell
& .\scripts\grocery-cart-poller\Install-GroceryCartPoller.ps1
Get-ScheduledTaskInfo -TaskName HomeConsole-GroceryCartPoller
$worker = Join-Path $env:LOCALAPPDATA 'HomeConsole\GroceryCartWorker'
Get-Content -LiteralPath (Join-Path $worker 'status.json')
```

The installer accepts `-QueueHelper` for a helper staged outside this checkout. It installs a single limited task, skips overlapping instances, and preserves the current activation state on reinstall. A fresh install starts held. After verifying queue trust, retailer routing and the authorized trial, create the empty `enabled` file and start the task. To pause new work, remove that file. A running provider operation may still finish.

```powershell
New-Item -Path (Join-Path $worker 'enabled') -ItemType File -Force | Out-Null
Start-ScheduledTask -TaskName HomeConsole-GroceryCartPoller
```

The computer must be awake, online and signed in under the configured user. Windows starts the next eligible poll when the machine becomes available. A conflicting retailer lease can defer work until expiry. Task Scheduler and `status.json` report local poll health. The console's per-request result is the source of truth for grocery outcomes.

The queue helper encrypts its operation journal with Windows DPAPI. The worker also saves provider cart-line evidence under `receipts` using current-user DPAPI. Exact queue operations can be replayed after a lost acknowledgement. Never replay an external cart mutation after a timeout. Reconcile provider evidence with the original request and retailer. Only product-line data, retailer name and diagnostic field names belong in the private receipt.

After a decoder update, an operator can record a verified saved reply against its original unresolved claim. Run the following in the installed worker directory with the original run ID. The command reports the remaining wait if the original claim still has its lease. Repeat this same command after that interval or after an interrupted acknowledgement.

```powershell
python -B .\recover_receipt.py <original-cart-run-id>
```

Recovery reads the encrypted before-and-after cart evidence on the computer and records confirmed per-request quantity changes through the Home Console queue. Instacart supplies the selling method for weighted items. A reported weight selling method does not establish a package size or weight unit. The worker preserves exact fractional cart quantities when comparing evidence.

## Isolated checks

Run `python -B -m unittest -v test_grocery_worker` in this directory on Windows. The tests use an in-memory provider and queue, temporary files, and Windows DPAPI. A live automated-shopping check requires a real authorized grocery addition and evidence from the provider response.
