import { NextResponse, type NextRequest } from 'next/server';
import { hasBearer, unauthorized } from '@/lib/auth';
import { listBacklog, listGroceries } from '@/lib/domain';

export const dynamic = 'force-dynamic';

/**
 * Warren's recipe agent can call this BEFORE picking recipes so its LLM prompt
 * sees what's still in the fridge/pantry and what household items were requested.
 */
export async function GET(req: NextRequest) {
  if (!hasBearer(req, process.env.RECIPE_AGENT_API_KEY)) return unauthorized();
  const [backlog, groceries] = await Promise.all([listBacklog(), listGroceries()]);
  return NextResponse.json({
    in_fridge_count: backlog.length,
    backlog: backlog.map((b) => ({
      id: b.id,
      name: b.recipe_or_item_name,
      perishables: b.key_perishables,
      location: b.location,
      delivery_date: b.delivery_date,
    })),
    household_requests: groceries.map((g) => ({ name: g.name, quantity: g.quantity })),
  });
}
