import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGroceryMcpHandler } from '../lib/grocery-agent-mcp';
import { groceryAgentRpc, validateGroceryDevelopmentDatabase } from '../lib/grocery-agent-store';

// Only the grocery endpoint is exposed. No kiosk, calendar, Slack or other API.
const configuration = Object.fromEntries(readFileSync(fileURLToPath(new URL('../.env.grocery-dev.local', import.meta.url)), 'utf8')
  .split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
  }));
const secret = configuration.HOME_CONSOLE_GROCERY_AGENT_KEY;
if (!secret || secret.length < 32) throw new Error('Run npm run db:groceries to create development configuration');
Object.assign(process.env, { NODE_ENV: 'development' });
process.env.HOME_CONSOLE_GROCERY_DEV_DATABASE_URL = validateGroceryDevelopmentDatabase(configuration.HOME_CONSOLE_GROCERY_DEV_DATABASE_URL);
process.env.HOME_CONSOLE_GROCERY_AGENT_KEY = secret;
const handler = createGroceryMcpHandler({ secret: () => secret, store: {
  listPending: runId => groceryAgentRpc('grocery_agent_list_pending', { p_run_id: runId }),
  recordProgress: operation => groceryAgentRpc('grocery_agent_progress', { p_operation: operation }),
} });
const server = http.createServer(async (req, res) => {
  try {
    if (req.url !== '/mcp' && req.url !== '/api/mcp') { res.writeHead(404); res.end(); return; }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32768) { res.writeHead(413); res.end(); return; }
      chunks.push(Buffer.from(chunk));
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    const response = await handler(new Request(`http://127.0.0.1:3003${req.url}`, {
      method: req.method, headers, ...(['GET', 'HEAD'].includes(req.method ?? '') ? {} : { body: Buffer.concat(chunks) }),
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500, { 'Cache-Control': 'no-store' }); res.end('Development endpoint unavailable'); }
});
server.requestTimeout = 15000;
server.listen(3003, '127.0.0.1', () => console.log('Home Console synthetic-data MCP: http://127.0.0.1:3003/mcp (bearer required)'));
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
