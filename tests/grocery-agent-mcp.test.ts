import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroceryMcpHandler, type GroceryAgentStore } from '../lib/grocery-agent-mcp';
import { groceryProgressSchema } from '../lib/grocery-agent-tools';

const SECRET = 'synthetic-connector-test-secret-123456789';
const RUN = 'sat-2026-11-21-0657';
const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const WORKER_TOKEN = '00000000-0000-4000-8000-000000000002';
const CLAIM_TOKEN = '00000000-0000-4000-8000-000000000003';
const PRODUCT = { product_id: 'test-milk-1', name: 'Synthetic milk', size: '1 gallon', quantity: 2 };
const OBSERVED = '2026-11-21T11:57:00Z';

function fixture(overrides: Partial<GroceryAgentStore> = {}) {
  const calls: Array<unknown> = [];
  const store: GroceryAgentStore = {
    async listPending(runId) { calls.push(runId); return { ok: true, run_id: runId, requests: [] }; },
    async recordProgress(operation) {
      calls.push(operation);
      return { ok: true, run_id: operation.run_id, request_id: operation.request_id, revision: operation.revision,
        worker_token: WORKER_TOKEN, claim_token: CLAIM_TOKEN, lease_expires_at: '2026-11-21T12:12:00Z' };
    },
    ...overrides,
  };
  return { calls, handler: createGroceryMcpHandler({ store, secret: () => SECRET }) };
}

function request(body: unknown, options: { method?: string; authorization?: string; headers?: Record<string, string>; url?: string } = {}) {
  const method = options.method ?? 'POST';
  return new Request(options.url ?? 'https://home-console.test/api/mcp', {
    method,
    headers: { authorization: options.authorization ?? `Bearer ${SECRET}`,
      'content-type': 'application/json', accept: 'application/json, text/event-stream', ...options.headers },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) }),
  });
}

const rpc = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) });
const prepare = () => ({ phase: 'prepare' as const, operation_id: 'prepare-1', run_id: RUN,
  request_id: REQUEST_ID, revision: 1, retailer: 'Wegmans' as const, product: PRODUCT,
  observed_cart: [], observed_at: OBSERVED });

test('every method fails closed for missing/wrong/config-unset credentials; query and cookie do not authenticate', async () => {
  const { handler, calls } = fixture();
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
    const response = await handler(request(rpc('tools/list'), { method, authorization: 'Bearer wrong' }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const queryAuth = await handler(request(rpc('tools/list'), { authorization: '',
    url: `https://home-console.test/api/mcp?key=${SECRET}`, headers: { cookie: `kiosk_key=${SECRET}` } }));
  assert.equal(queryAuth.status, 401);
  const missing = createGroceryMcpHandler({ secret: () => undefined, store: {
    async listPending() { throw new Error('Must not run'); }, async recordProgress() { throw new Error('Must not run'); },
  } });
  assert.equal((await missing(request(rpc('tools/list')))).status, 401);
  assert.equal(calls.length, 0);
});

test('initialization and independent consecutive requests use fresh stateless servers', async () => {
  const { handler } = fixture();
  const response = await handler(request(rpc('initialize', {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test-client', version: '1' },
  })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('mcp-session-id'), null);
  const initial = await response.json();
  assert.equal(initial.result.serverInfo.name, 'Home Console');
  assert.match(initial.result.instructions, /checks out manually/);
  for (let i = 0; i < 3; i++) {
    const listed = await handler(request(rpc('tools/list')));
    assert.equal(listed.status, 200);
    const result = await listed.json();
    assert.deepEqual(result.result.tools.map((tool: { name: string }) => tool.name), ['list_pending', 'record_request_progress']);
    for (const tool of result.result.tools) {
      assert.equal(tool.annotations.readOnlyHint, false);
      assert.equal(tool.annotations.idempotentHint, true);
      assert.match(tool.description.toLowerCase(), /home console/);
      assert.match(tool.description, /grocery pending requests/);
    }
    assert.match(result.result.tools[1].description, /worker_token/);
    assert.match(result.result.tools[1].description, /claim_token/);
    assert.match(result.result.tools[1].description, /15 minutes/);
  }
});

test('authenticating does not permit cross-origin access or unsupported methods', async () => {
  const { handler, calls } = fixture();
  assert.equal((await handler(request(rpc('tools/list'), { headers: { origin: 'https://untrusted.test' } }))).status, 403);
  for (const method of ['GET', 'DELETE', 'PUT', 'PATCH', 'OPTIONS', 'HEAD']) {
    const response = await handler(request({}, { method }));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  }
  assert.equal(calls.length, 0);
});

test('pending snapshot calls reach the store once and return structured, equivalent text data', async () => {
  const { handler, calls } = fixture();
  const response = await handler(request(rpc('tools/call', { name: 'list_pending', arguments: { run_id: RUN } })));
  const result = (await response.json()).result;
  assert.deepEqual(calls, [RUN]);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.structuredContent.run_id, RUN);
});

test('prepare and complete preserve actual product fields and required scoped tokens', async () => {
  const { handler, calls } = fixture();
  const response = await handler(request(rpc('tools/call', { name: 'record_request_progress', arguments: { operation: prepare() } })));
  const result = (await response.json()).result;
  assert.equal(result.structuredContent.worker_token, WORKER_TOKEN);
  assert.equal(result.structuredContent.claim_token, CLAIM_TOKEN);
  assert.deepEqual((calls[0] as { product: unknown }).product, PRODUCT);
  const complete = { ...prepare(), phase: 'complete', operation_id: 'complete-1',
    outcome: 'in_cart', worker_token: WORKER_TOKEN, claim_token: CLAIM_TOKEN };
  const completed = await handler(request(rpc('tools/call', { name: 'record_request_progress', arguments: { operation: complete } })));
  assert.equal((await completed.json()).result.isError, undefined);
  assert.equal(calls.length, 2);
});

test('unknown fields, oversized input, unsupported retailer and unsafe phase shapes never reach the store', async () => {
  const { handler, calls } = fixture();
  const malformed = [
    { ...prepare(), retailer: 'Unknown' },
    { ...prepare(), product: { ...PRODUCT, quantity: 1.5 } },
    { ...prepare(), product: { ...PRODUCT, name: 'x'.repeat(251) } },
    { ...prepare(), observed_cart: undefined },
    { ...prepare(), outcome: 'in_cart' },
    { ...prepare(), phase: 'complete', outcome: 'in_cart' },
    { ...prepare(), phase: 'complete', outcome: 'needs_attention' },
    { ...prepare(), phase: 'complete', outcome: 'ordered' },
    { ...prepare(), service_role_key: 'must-not-be-accepted' },
    { ...prepare(), request_id: 'invented-recipe-id' },
  ];
  for (const operation of malformed) {
    const response = await handler(request(rpc('tools/call', { name: 'record_request_progress', arguments: { operation } })));
    assert.equal((await response.json()).result.isError, true);
  }
  assert.equal(calls.length, 0);
  const oversized = await handler(request(rpc('tools/call', { name: 'list_pending', arguments: { run_id: 'x'.repeat(40_000) } })));
  assert.equal(oversized.status, 413);
});

test('recovery cannot claim a new addition; a directly covered result needs no claim token', () => {
  const recovery = { ...prepare(), phase: 'complete', outcome: 'already_in_cart', recovery_attempt_id: CLAIM_TOKEN };
  assert.equal(groceryProgressSchema.safeParse(recovery).success, true);
  assert.equal(groceryProgressSchema.safeParse({ ...recovery, outcome: 'in_cart', worker_token: WORKER_TOKEN, claim_token: CLAIM_TOKEN }).success, false);
  assert.equal(groceryProgressSchema.safeParse({ ...prepare(), phase: 'complete', outcome: 'pending', reason: 'No stock information available; addition not attempted.' }).success, true);
});

test('store exceptions are generic and known credential fields are removed while scoped tokens remain', async () => {
  const { handler } = fixture({ async listPending() { throw new Error(`Database password=private; token=${SECRET}`); } });
  const failure = await handler(request(rpc('tools/call', { name: 'list_pending', arguments: { run_id: RUN } })));
  const body = await failure.text();
  assert.doesNotMatch(body, /Database password|private/);
  assert.equal(body.includes(SECRET), false);
  assert.equal(JSON.parse(body).result.structuredContent.code, 'store_unavailable');
  const sanitized = fixture({ async listPending() { return { ok: true, secret: 'private', authorization: 'Bearer private',
    worker_token: WORKER_TOKEN, claim_token: CLAIM_TOKEN, request: { name: SECRET, api_key: 'private' } }; } });
  const response = await sanitized.handler(request(rpc('tools/call', { name: 'list_pending', arguments: { run_id: RUN } })));
  const result = (await response.json()).result.structuredContent;
  assert.equal(result.secret, undefined);
  assert.equal(result.authorization, undefined);
  assert.equal(result.worker_token, WORKER_TOKEN);
  assert.equal(result.claim_token, CLAIM_TOKEN);
  assert.deepEqual(result.request, { name: '[redacted]' });
});

test('expected domain conflicts remain machine-readable tool failures', async () => {
  const { handler } = fixture({ async recordProgress() { return { ok: false, code: 'revision_conflict', message: 'Reread the current request.', retryable: false }; } });
  const response = await handler(request(rpc('tools/call', { name: 'record_request_progress', arguments: { operation: prepare() } })));
  const result = (await response.json()).result;
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, 'revision_conflict');
  assert.equal(result.structuredContent.retryable, false);
});

test('cart contention preserves actionable expiry and holder metadata', async () => {
  const conflict = { ok: false, code: 'cart_busy', message: 'Wait for the cart lease.', retryable: true,
    retailer: 'Morton Williams Supermarket', blocking_run_id: 'dev-prior-run',
    lease_expires_at: '2026-11-16T00:48:34.081154+00:00', retry_after_seconds: 120 };
  const { handler } = fixture({ async recordProgress() { return conflict; } });
  const response = await handler(request(rpc('tools/call', { name: 'record_request_progress', arguments: { operation: prepare() } })));
  const result = (await response.json()).result;
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, conflict);
});
