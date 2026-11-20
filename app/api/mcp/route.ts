import { createGroceryMcpHandler } from '@/lib/grocery-agent-mcp';
import { listGroceryAgentRequests, recordGroceryAgentProgress } from '@/lib/domain';
import { isBetaDeployment } from '@/lib/beta-deployment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const mcpHandler = createGroceryMcpHandler({
  store: { listPending: listGroceryAgentRequests, recordProgress: recordGroceryAgentProgress },
  secret: () => process.env.HOME_CONSOLE_GROCERY_AGENT_KEY,
});

const handler = (request: Request) => isBetaDeployment()
  ? mcpHandler(request)
  : Response.json({ error: 'Not found' }, { status: 404 });

// Every supported route method reaches the dedicated bearer check first.
export const POST = handler;
export const GET = handler;
export const DELETE = handler;
export const PUT = handler;
export const PATCH = handler;
export const HEAD = handler;
export const OPTIONS = handler;
