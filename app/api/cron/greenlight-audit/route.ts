import { NextResponse, type NextRequest } from 'next/server';
import { cronGate } from '@/lib/cron';
import { greenlightSummary } from '@/lib/domain';
import { claimRun, releaseRun, saveRunMessage } from '@/lib/runs';
import { CHANNELS, mention, postMessage } from '@/lib/slack/api';
import { greenlightBlocks } from '@/lib/slack/blocks';
import { addDays, todayISO } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** Weekly, the evening before Greenlight pays out: reconcile Wesley's chores. */
export async function GET(req: NextRequest) {
  const gate = cronGate(req, {
    hour: Number(process.env.GREENLIGHT_AUDIT_HOUR ?? 18),
    weekday: process.env.GREENLIGHT_AUDIT_WEEKDAY ?? 'Fri',
  });
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const end = todayISO();
  const start = addDays(end, -6);
  if (!(await claimRun('greenlight-audit', end))) return NextResponse.json({ skipped: 'already posted' });
  try {
    const summary = await greenlightSummary(start, end);
    const msg = await postMessage(
      CHANNELS.chores(),
      `${mention('daniela')} ${mention('warren')} Wesley's chore audit before Greenlight payout`,
      greenlightBlocks(summary),
    );
    await saveRunMessage('greenlight-audit', end, msg.channel, msg.ts);
    return NextResponse.json({ ok: true, done: summary.done, total: summary.total });
  } catch (e) {
    await releaseRun('greenlight-audit', end);
    throw e;
  }
}
