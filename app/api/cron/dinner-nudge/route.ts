import { NextResponse, type NextRequest } from 'next/server';
import { cronGate } from '@/lib/cron';
import { getKitchenState } from '@/lib/domain';
import { claimRun, releaseRun, saveRunMessage } from '@/lib/runs';
import { CHANNELS, postMessage } from '@/lib/slack/api';
import { nudgeBlocks } from '@/lib/slack/blocks';
import { todayISO } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** 2:00 PM — if nobody has claimed dinner, ping both parents. */
export async function GET(req: NextRequest) {
  const gate = cronGate(req, { hour: Number(process.env.DINNER_NUDGE_HOUR ?? 14) });
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const date = todayISO();
  const state = await getKitchenState(date);
  if (state.dinner.status !== 'unclaimed') return NextResponse.json({ skipped: 'dinner already claimed' });
  if (!(await claimRun('dinner-nudge', date))) return NextResponse.json({ skipped: 'already nudged today' });
  try {
    const msg = await postMessage(CHANNELS.food(), "Dinner's still unclaimed!", nudgeBlocks(state));
    await saveRunMessage('dinner-nudge', date, msg.channel, msg.ts);
    return NextResponse.json({ ok: true, ts: msg.ts });
  } catch (e) {
    await releaseRun('dinner-nudge', date);
    throw e;
  }
}
