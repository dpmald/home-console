import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod/v4';
import {
  GROCERY_LIST_DESCRIPTION,
  GROCERY_PROGRESS_DESCRIPTION,
  GROCERY_SERVER_INSTRUCTIONS,
  groceryProgressSchema,
  groceryRunIdSchema,
  type GroceryProgressOperation,
} from './grocery-agent-tools';

export interface GroceryAgentStore {
  listPending(runId: string): Promise<Record<string, unknown>>;
  recordProgress(operation: GroceryProgressOperation): Promise<Record<string, unknown>>;
}

export interface GroceryMcpOptions {
  store: GroceryAgentStore;
  secret: () => string | undefined;
}

const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_RESULT_BYTES = 128 * 1024;
const PRIVATE_KEYS = /^(?:authorization|password|secret|api_?key|access_token|service_role_key|supabase_service_role_key|home_console_grocery_agent_key)$/i;

function authenticated(request: Request, secret: string | undefined): secret is string {
  if (!secret || secret.trim() !== secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(request.headers.get('authorization') ?? '');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(status === 401 ? { 'WWW-Authenticate': 'Bearer realm="Home Console"' } : {}),
    ...(status === 405 ? { Allow: 'POST' } : {}),
  } });
}

/** Keep operation tokens, but never expose authentication credentials or raw errors. */
function resultForAgent(value: Record<string, unknown>, secret: string) {
  const encoded = JSON.stringify(value, (key, field: unknown) => {
    if (PRIVATE_KEYS.test(key)) return undefined;
    return typeof field === 'string' ? field.split(secret).join('[redacted]') : field;
  });
  if (!encoded || Buffer.byteLength(encoded) > MAX_RESULT_BYTES) throw new Error('Invalid or oversized tool result.');
  const result = JSON.parse(encoded) as Record<string, unknown>;
  return {
    content: [{ type: 'text' as const, text: encoded }],
    structuredContent: result,
    ...(result.ok === false ? { isError: true } : {}),
  };
}

async function executeSafely(action: () => Promise<Record<string, unknown>>, secret: string) {
  try {
    return resultForAgent(await action(), secret);
  } catch {
    return resultForAgent({
      ok: false,
      code: 'store_unavailable',
      message: 'Home Console could not confirm this operation. Retry the same run or operation ID and payload. Do not repeat an uncertain cart addition.',
      retryable: true,
    }, secret);
  }
}

function createServer(store: GroceryAgentStore, secret: string): McpServer {
  const server = new McpServer({ name: 'Home Console', version: '1.0.0' }, {
    instructions: GROCERY_SERVER_INSTRUCTIONS,
  });
  server.registerTool('list_pending', {
    title: 'Home Console grocery pending requests',
    description: GROCERY_LIST_DESCRIPTION,
    inputSchema: z.object({ run_id: groceryRunIdSchema }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ run_id }) => executeSafely(async () => {
    const snapshot = await store.listPending(run_id);
    return snapshot.ok === true && snapshot.cart_quantity_format === 2
      ? { ...snapshot, weighted_observations: true }
      : snapshot;
  }, secret));
  server.registerTool('record_request_progress', {
    title: 'Home Console grocery request progress',
    description: GROCERY_PROGRESS_DESCRIPTION,
    inputSchema: z.object({ operation: groceryProgressSchema }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ operation }) => executeSafely(() => store.recordProgress(operation), secret));
  return server;
}

/** Stateless transport: durable state belongs in the store, never this server instance. */
export function createGroceryMcpHandler(options: GroceryMcpOptions) {
  return async (request: Request): Promise<Response> => {
    const secret = options.secret();
    if (!authenticated(request, secret)) return jsonError(401, 'unauthorized');
    // Remote MCP calls are server-to-server. Browser origins may only be same-origin.
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return jsonError(403, 'origin_not_allowed');
    // No sessions or server-initiated notifications: GET/SSE and DELETE are unnecessary.
    if (request.method !== 'POST') return jsonError(405, 'method_not_allowed');
    const server = createServer(options.store, secret);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: MAX_REQUEST_BYTES,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store');
      headers.set('X-Content-Type-Options', 'nosniff');
      const body = await response.text();
      // Also sanitize protocol error text, which may quote a supplied header.
      return new Response(body ? body.split(secret).join('[redacted]') : null, { status: response.status, headers });
    } catch {
      return jsonError(500, 'mcp_request_failed');
    } finally {
      await server.close().catch(() => {});
    }
  };
}
