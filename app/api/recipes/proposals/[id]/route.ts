import { NextResponse, type NextRequest } from 'next/server';
import { hasBearer, unauthorized } from '@/lib/auth';
import { getProposal } from '@/lib/cart';

export const dynamic = 'force-dynamic';

/** Agent polls this until status is 'approved' (place order) or 'rejected'. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasBearer(req, process.env.RECIPE_AGENT_API_KEY)) return unauthorized();
  const { id } = await params;
  try {
    const p = await getProposal(id);
    return NextResponse.json({
      proposal_id: p.id,
      status: p.status,
      decided_by: p.decided_by,
      decided_at: p.decided_at,
      delivery_date: p.delivery_date,
      recipes: p.kept_recipes,
      items: p.status === 'approved' ? p.items : [],
    });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
