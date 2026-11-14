import { after, NextResponse, type NextRequest } from 'next/server';
import { decideProposal, notifyAgent } from '@/lib/cart';
import { getKitchenState } from '@/lib/domain';
import { updateMessage } from '@/lib/slack/api';
import { cartBlocks } from '@/lib/slack/blocks';
import { refreshDinnerMessages } from '@/lib/slack/sync';
import { todayISO } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** Lets Daniela or Warren approve/hold a Saturday order directly on the wall screen too. */
export async function POST(req: NextRequest) {
  const { id, approve, by } = (await req.json()) as { id: string; approve: boolean; by?: string };
  const p = await decideProposal(id, !!approve, by || 'Kitchen screen');
  after(async () => {
    if (p.slack_channel && p.slack_ts) await updateMessage(p.slack_channel, p.slack_ts, `Order ${p.status}`, cartBlocks(p));
    await notifyAgent(p);
    await refreshDinnerMessages(todayISO());
  });
  return NextResponse.json(await getKitchenState(todayISO()));
}
