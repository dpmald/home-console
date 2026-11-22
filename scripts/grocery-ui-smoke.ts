import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function checkGroceryFlow(origin: string, deviceKey: string, agentKey: string) {
  const device = { Authorization: 'Bearer ' + deviceKey, 'Content-Type': 'application/json', Origin: origin };
  const request = (path: string, init?: RequestInit) => fetch(origin + path, {
    ...init, redirect: 'error', signal: AbortSignal.timeout(60000),
  });
  const run = 'http-' + randomUUID();
  const name = 'Synthetic milk ' + run;
  const batch = { action: 'add', operation_id: run, items: [{ name, quantity: '2 cartons' }] };
  const post = (body: unknown) => request('/api/groceries', { method: 'POST', headers: device, body: JSON.stringify(body) });

  assert.equal((await request('/api/groceries')).status, 401);
  assert.equal((await request('/api/voice/tool', { method: 'POST', headers: device })).status, 404);
  assert.equal((await request('/api/groceries', { method: 'POST',
    headers: { ...device, Origin: 'https://other.example.test' }, body: JSON.stringify(batch) })).status, 403);
  const added = await post(batch);
  assert.equal(added.status, 200, 'Beta device add');
  const { added_ids: ids } = await added.json();
  assert.equal(ids.length, 1);
  const replay = await post(batch);
  assert.equal(replay.status, 200);
  const receipt = await replay.json();
  assert.equal(receipt.replayed, true);
  assert.deepEqual(receipt.added_ids, ids);
  assert.equal((await post({ ...batch, items: [{ name: 'different item' }] })).status, 409);

  let rpcId = 0;
  async function rpc(method: string, params: object) {
    const response = await request('/api/mcp', {
      method: 'POST', headers: { Authorization: 'Bearer ' + agentKey, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    assert.equal(response.status, 200, method);
    const body = await response.json();
    assert.ok(!body.error);
    return body.result;
  }
  assert.equal((await request('/api/mcp', { method: 'POST', headers: device, body: '{}' })).status, 401);
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } });
  const tool = async (name: string, args: object) => (await rpc('tools/call', { name, arguments: args })).structuredContent;
  const pending = await tool('list_pending', { run_id: run });
  assert.ok(pending.requests.some((row: { id: string }) => row.id === ids[0]));
  const common = { run_id: run, request_id: ids[0], revision: 1, retailer: 'Morton Williams Supermarket',
    product: { product_id: 'SIMULATED-MILK', name: 'Synthetic milk', size: '1 carton', quantity: 2 } };
  const progress = (operation: object) => tool('record_request_progress', { operation });
  const prepared = await progress({ ...common, phase: 'prepare', operation_id: 'prepare:' + run,
    observed_cart: [], observed_at: new Date().toISOString() });
  assert.equal(prepared.ok, true, 'prepare simulated cart evidence');
  const complete = { ...common, phase: 'complete', operation_id: 'complete:' + run, outcome: 'in_cart',
    worker_token: prepared.worker_token, claim_token: prepared.claim_token, observed_at: new Date().toISOString() };
  const done = await progress(complete);
  assert.equal(done.ok, true);
  const repeated = await progress(complete);
  assert.equal(repeated.replayed, true);
  assert.equal(repeated.attempt_id, done.attempt_id);

  const response = await request('/api/groceries', { headers: device });
  assert.equal(response.status, 200);
  const display = await response.json();
  const matches = display.items.filter((row: { name: string }) => row.name === name);
  assert.equal(matches.length, 1, 'a retried save must leave exactly one item');
  const [item] = matches;
  assert.equal(item.id, ids[0]);
  assert.equal(item.status, 'in_cart');
  assert.equal(item.quantity, '2 cartons');
  assert.equal(item.result.product_name, common.product.name);
  for (const token of [prepared.worker_token, prepared.claim_token]) assert.ok(!JSON.stringify(display).includes(token));
}

// Keep the documented direct command usable. It now creates its own disposable Beta.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  execFileSync(process.execPath, ['scripts/test-beta.mjs'], { stdio: 'inherit' });
}
