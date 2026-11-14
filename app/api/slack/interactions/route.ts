import { after, NextResponse, type NextRequest } from 'next/server';
import { verifySlackSignature } from '@/lib/slack/verify';
import { parentFromSlackUser, updateMessage } from '@/lib/slack/api';
import { cartBlocks, greenlightBlocks } from '@/lib/slack/blocks';
import { refreshDinnerMessages } from '@/lib/slack/sync';
import {
  assignLogistics, claimDinner, cookFromBacklog, greenlightSummary, markDinnerCooked,
  markGreenlightVerified, setNotTonight,
} from '@/lib/domain';
import { decideProposal, notifyAgent } from '@/lib/cart';
import { NAMES, isParent } from '@/lib/family';
import type { Parent } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Slack interactivity endpoint. DB writes are quick (<300 ms) and happen
 * inline; message re-renders run in after() so we ack well under 3 s.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySlackSignature(raw, req.headers)) return new NextResponse('invalid signature', { status: 401 });

  const payload = JSON.parse(new URLSearchParams(raw).get('payload') ?? '{}');
  if (payload.type !== 'block_actions') return new NextResponse(null, { status: 200 });

  const actor = parentFromSlackUser(payload.user?.id);
  const actorName = actor ? NAMES[actor] : payload.user?.name ?? 'someone';
  const msg = { channel: payload.channel?.id as string | undefined, ts: payload.message?.ts as string | undefined };

  for (const action of payload.actions ?? []) {
    try {
      await handle(action, actor, actorName, msg);
    } catch (e) {
      console.error('Slack action failed', action?.action_id, e);
    }
  }
  return new NextResponse(null, { status: 200 });
}

async function handle(
  action: any,
  actor: Parent | null,
  actorName: string,
  msg: { channel?: string; ts?: string },
) {
  const [kind, arg] = String(action.action_id).split(':');
  const via = `slack:${actorName}`;

  switch (kind) {
    case 'dinner_claim': {
      if (arg !== 'daniela' && arg !== 'warren' && arg !== 'takeout') return;
      const date = String(action.value);
      await claimDinner(date, arg, via);
      after(() => refreshDinnerMessages(date));
      return;
    }
    case 'dinner_backlog': {
      const { d, b } = JSON.parse(action.selected_option?.value ?? '{}');
      await cookFromBacklog(d, b, actor, via);
      after(() => refreshDinnerMessages(d));
      return;
    }
    case 'dinner_cooked': {
      const date = String(action.value);
      await markDinnerCooked(date, via);
      after(() => refreshDinnerMessages(date));
      return;
    }
    case 'dinner_unavailable': {
      if (!isParent(arg)) return;
      const { d, u } = JSON.parse(action.value);
      await setNotTonight(d, arg, !!u, via);
      after(() => refreshDinnerMessages(d));
      return;
    }
    case 'logistics_assign': {
      if (!isParent(arg)) return;
      const { id, d } = JSON.parse(action.value);
      await assignLogistics(id, arg);
      after(() => refreshDinnerMessages(d));
      return;
    }
    case 'cart_approve':
    case 'cart_reject': {
      const p = await decideProposal(String(action.value), kind === 'cart_approve', actorName);
      after(async () => {
        const channel = p.slack_channel ?? msg.channel;
        const ts = p.slack_ts ?? msg.ts;
        if (channel && ts) await updateMessage(channel, ts, `Order ${p.status}`, cartBlocks(p));
        await notifyAgent(p);
      });
      return;
    }
    case 'greenlight_verified': {
      const { s, e } = JSON.parse(action.value);
      await markGreenlightVerified(s, e);
      after(async () => {
        if (msg.channel && msg.ts) {
          await updateMessage(msg.channel, msg.ts, "Wesley's chores reconciled", greenlightBlocks(await greenlightSummary(s, e)));
        }
      });
      return;
    }
  }
}
