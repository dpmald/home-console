import type { NextRequest } from 'next/server';
import { requireKioskRequest } from '@/lib/kiosk-auth';
import { changeGroceryRequests, GroceryRequestError, listGroceryRequests } from '@/lib/grocery-requests';
import { readBoundedBody, RequestBodyError } from '@/lib/request-body';
import { isBetaDeployment } from '@/lib/beta-deployment';

export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(req: NextRequest) {
  if (!isBetaDeployment()) return json({ error: 'Not found' }, 404);
  const denied = requireKioskRequest(req);
  if (denied) return denied;
  try { return json(await listGroceryRequests()); }
  catch { return json({ error: 'Groceries are unavailable. Try refreshing the list.' }, 503); }
}
export async function POST(req: NextRequest) {
  if (!isBetaDeployment()) return json({ error: 'Not found' }, 404);
  const denied = requireKioskRequest(req, true);
  if (denied) return denied;
  try {
    if (Number(req.headers.get('content-length')) > 24000) return json({ error: 'Too many items in one request.' }, 413);
    if (!req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Expected a grocery request.' }, 415);
    const raw = await readBoundedBody(req, 24000);
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return json({ error: 'Invalid grocery request.' }, 400); }
    return json(await changeGroceryRequests(input));
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, 413);
    if (error instanceof GroceryRequestError) return json({ error: error.message, code: error.code }, error.status);
    return json({ error: 'The save could not be confirmed. Retry the same request to check it safely.' }, 503);
  }
}
