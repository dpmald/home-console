import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { validateGroceryDevelopmentDatabase } from '../lib/grocery-agent-store';
import { validateGrocerySmokeEndpoint } from '../lib/grocery-dev-isolation.mjs';

async function main() {
const env = Object.fromEntries(readFileSync(new URL('../.env.grocery-dev.local', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
  }));
const endpointValue = process.argv[2] ?? 'http://127.0.0.1:3003/mcp';
let approvedEndpoint: string | undefined;
if (endpointValue !== 'http://127.0.0.1:3003/mcp') {
  const approved = JSON.parse(readFileSync(new URL('../node_modules/.cache/grocery-tools/endpoint.json', import.meta.url), 'utf8'));
  if (approved.credentialTransferApproved !== true) throw new Error('External credential transfer has not been approved');
  approvedEndpoint = approved.url;
}
const endpoint = validateGrocerySmokeEndpoint(endpointValue, approvedEndpoint);
const database = new pg.Client({ connectionString: validateGroceryDevelopmentDatabase(env.HOME_CONSOLE_GROCERY_DEV_DATABASE_URL) });
const requestId = randomUUID();
const runId = `smoke-${randomUUID()}`;
let rpcId = 0;
const rpc = async (method: string, params: object = {}) => {
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${env.HOME_CONSOLE_GROCERY_AGENT_KEY}`,
  }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, 'Authenticated JSON-RPC request must succeed');
  const message = await response.json();
  assert.ok(!message.error, 'JSON-RPC must not report an error');
  return message.result;
};
await database.connect();
try {
  const unauthorized = await fetch(endpoint, { method: 'POST', redirect: 'error', body: '{}', signal: AbortSignal.timeout(15000) });
  assert.equal(unauthorized.status, 401, 'Remote endpoint must reject unauthenticated callers');
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'grocery-development-smoke', version: '1' } });
  assert.equal(init.serverInfo.name, 'Home Console');
  const tools = await rpc('tools/list');
  assert.deepEqual(tools.tools.map((tool: { name: string }) => tool.name).sort(), ['list_pending', 'record_request_progress']);
  writeFileSync(new URL('../docs/GROCERY-CONNECTOR-TOOLS.json', import.meta.url), `${JSON.stringify(tools, null, 2)}\n`);
  await database.query('insert into public.grocery_items(id,name,quantity,added_by) values($1,$2,$3,$4)', [requestId, 'Synthetic smoke item', '2 packages', 'Automated smoke fixture']);
  const pending = await rpc('tools/call', { name: 'list_pending', arguments: { run_id: runId } });
  assert.equal(pending.structuredContent.ok, true);
  const request = pending.structuredContent.requests.find((item: { id: string }) => item.id === requestId);
  assert.ok(request, 'Snapshot must include the synthetic request');
  const product = { product_id: 'synthetic-smoke-product', name: 'Synthetic smoke product', size: '1 package', quantity: 2 };
  const prepare = { phase: 'prepare', operation_id: `${runId}-prepare`, run_id: runId, request_id: requestId,
    revision: request.revision, retailer: 'Morton Williams Supermarket', product, observed_cart: [], observed_at: new Date().toISOString() };
  const prepared = (await rpc('tools/call', { name: 'record_request_progress', arguments: { operation: prepare } })).structuredContent;
  assert.equal(prepared.ok, true, 'Synthetic prepare must succeed');
  assert.ok(prepared.worker_token && prepared.claim_token && prepared.lease_expires_at);
  const completedOperation = { phase: 'complete', operation_id: `${runId}-complete`, run_id: runId, request_id: requestId,
    revision: request.revision, retailer: 'Morton Williams Supermarket', product, observed_at: new Date().toISOString(),
    outcome: 'in_cart', worker_token: prepared.worker_token, claim_token: prepared.claim_token };
  const completed = (await rpc('tools/call', { name: 'record_request_progress', arguments: { operation: completedOperation } })).structuredContent;
  assert.equal(completed.ok, true, 'Synthetic completion must succeed');
  const replay = (await rpc('tools/call', { name: 'record_request_progress', arguments: { operation: completedOperation } })).structuredContent;
  assert.equal(replay.replayed, true);
  assert.equal(replay.attempt_id, completed.attempt_id);
  const saved = await database.query('select status,revision from public.grocery_items where id=$1', [requestId]);
  assert.equal(saved.rows[0].status, 'in_cart');
  assert.equal(saved.rows[0].revision, request.revision);
  console.log('PASS: unauthenticated denial, MCP initialize/discovery, durable synthetic snapshot, prepare, complete, replay and database readback. No Instacart calls.');
} finally {
  // Only this run's generated fixture and bookkeeping; leave Claude's two fixtures intact.
  await database.query('begin');
  try {
    await database.query('delete from public.grocery_agent_operations where payload->>\'run_id\'=$1', [runId]);
    await database.query('delete from public.grocery_agent_attempts where run_id=$1', [runId]);
    await database.query('delete from public.grocery_agent_cart_leases where run_id=$1', [runId]);
    await database.query('delete from public.grocery_agent_runs where run_id=$1', [runId]);
    await database.query('delete from public.grocery_items where id=$1', [requestId]);
    await database.query('commit');
  } catch { await database.query('rollback'); throw new Error('Smoke fixture cleanup failed'); }
  await database.end();
}
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'MCP smoke verification failed');
  process.exitCode = 1;
});
