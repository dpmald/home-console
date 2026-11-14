import { NextResponse, type NextRequest } from 'next/server';
import { cronGate } from '@/lib/cron';
import { getKitchenState } from '@/lib/domain';
import { claimRun, releaseRun, saveRunMessage } from '@/lib/runs';
import { CHANNELS, postMessage } from '@/lib/slack/api';
import { standupBlocks } from '@/lib/slack/blocks';
import { fmtDay, todayISO } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** 9:00 AM — logistics + conflicts + "who's cooking tonight?" */
export async function GET(req: NextRequest) {
  const gate = cronGate(req, { hour: Number(process.env.STANDUP_HOUR ?? 9) });
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const date = todayISO();
  if (!(await claimRun('daily-standup', date))) return NextResponse.json({ skipped: 'already posted today' });
  try {
    const state = await getKitchenState(date);
    const msg = await postMessage(CHANNELS.logistics(), `Daily standup — ${fmtDay(date)}`, standupBlocks(state));
    await saveRunMessage('daily-standup', date, msg.channel, msg.ts);
    return NextResponse.json({ ok: true, ts: msg.ts });
  } catch (e) {
    await releaseRun('daily-standup', date);
    throw e;
  }
}
