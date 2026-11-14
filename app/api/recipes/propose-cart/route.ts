import { NextResponse, type NextRequest } from 'next/server';
import { hasBearer, unauthorized } from '@/lib/auth';
import { proposeCart, type ProposeCartInput } from '@/lib/cart';

export const dynamic = 'force-dynamic';

/**
 * Warren's recipe agent calls this (e.g. Thursday evening) INSTEAD of
 * placing the order directly. We check the fridge backlog, scale the plan
 * down, skip duplicate perishables, merge the household list, and post to
 * #food for approval. The agent then waits for approval (callback or poll).
 */
export async function POST(req: NextRequest) {
  if (!hasBearer(req, process.env.RECIPE_AGENT_API_KEY)) return unauthorized();
  let body: ProposeCartInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!Array.isArray(body?.recipes)) return NextResponse.json({ error: 'recipes[] is required' }, { status: 400 });

  const { proposal, slackError } = await proposeCart(body);
  return NextResponse.json({
    proposal_id: proposal.id,
    status: 'pending_approval',
    delivery_date: proposal.delivery_date,
    still_in_fridge: proposal.backlog_snapshot.map((b) => ({ name: b.recipe_or_item_name, perishables: b.key_perishables })),
    kept_recipes: proposal.kept_recipes.map((r) => r.name),
    dropped_recipes: proposal.dropped_recipes.map((r) => r.name),
    items: proposal.items,
    skipped_items: proposal.skipped_items,
    poll_url: `/api/recipes/proposals/${proposal.id}`,
    ...(slackError ? { warning: `Saved, but Slack post failed: ${slackError}` } : {}),
  });
}
