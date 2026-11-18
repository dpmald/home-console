import { NextResponse, type NextRequest } from 'next/server';
import { hasBearer } from '@/lib/auth';
import { assignLogistics, getKitchenState } from '@/lib/domain';
import { NAMES } from '@/lib/family';
import { PICKUP_NUDGE, outstandingPickups, parseClaimReply, todaysPickups } from '@/lib/pickups';
import { claimRun, getRuns, releaseRun, saveRunMessage } from '@/lib/runs';
import {
  CHANNELS, SLACK_IDS, getThreadReplies, mention, parentFromSlackUser, postMessage, postThreadReply,
} from '@/lib/slack/api';
import { esc, pickupNudgeBlocks } from '@/lib/slack/blocks';
import { refreshDinnerMessages } from '@/lib/slack/sync';
import { fmtTime, localMinutes, todayISO } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Pickup nudge for #calendar. Safe to call as often as you like (n8n hits it
 * every 10 min; a daily Vercel cron is a backup). Each call:
 *   1. ≥ 2 PM, no nudge yet, and a pickup is unclaimed → post the nudge (once/day).
 *   2. Nudge exists → read new thread replies and apply claims ("I've got it").
 *   3. ≥ 4 PM and still unclaimed → one follow-up ping (once/day, also shown in channel).
 * Outside 2 PM–7 PM it returns immediately.
 *
 * Testing: `?force=1` ignores the time window; `?followup=1` forces step 3.
 */
export async function GET(req: NextRequest) {
  if (!hasBearer(req, process.env.CRON_SECRET)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const qp = req.nextUrl.searchParams;
  const force = qp.get('force') === '1';
  const forceFollowUp = qp.get('followup') === '1';

  const now = new Date();
  const mins = localMinutes(now);
  if (!force && !forceFollowUp && (mins < PICKUP_NUDGE.start() || mins >= PICKUP_NUDGE.stop())) {
    return NextResponse.json({ skipped: 'outside pickup nudge window', localMinutes: mins });
  }

  const date = todayISO(now);
  const state = await getKitchenState(date);
  const open = () => outstandingPickups(todaysPickups(state.events, date), now);
  const runs = await getRuns([PICKUP_NUDGE.job, PICKUP_NUDGE.followUpJob, PICKUP_NUDGE.cursorJob], date);
  const main = runs.find((r) => r.job === PICKUP_NUDGE.job);

  // ── 1. First ping ────────────────────────────────────────────────
  if (!main) {
    if (!open().length) return NextResponse.json({ skipped: 'all pickups covered' });
    if (!(await claimRun(PICKUP_NUDGE.job, date))) return NextResponse.json({ skipped: 'already nudged today' });
    try {
      const msg = await postMessage(CHANNELS.calendar(), 'Pickups still need an owner', pickupNudgeBlocks(state, now));
      await saveRunMessage(PICKUP_NUDGE.job, date, msg.channel, msg.ts);
      // If the first ping is already after 4 PM, it *is* the follow-up.
      if (mins >= PICKUP_NUDGE.followUp()) await claimRun(PICKUP_NUDGE.followUpJob, date);
      return NextResponse.json({ ok: true, posted: msg.ts, unclaimed: open().length });
    } catch (e) {
      await releaseRun(PICKUP_NUDGE.job, date);
      throw e;
    }
  }
  if (!main.slack_channel || !main.slack_ts) return NextResponse.json({ skipped: 'nudge is still being posted' });
  const channel = main.slack_channel;
  const thread = main.slack_ts;

  // ── 2. Read thread replies since last check ──────────────────────
  const cursor = runs.find((r) => r.job === PICKUP_NUDGE.cursorJob)?.slack_ts ?? thread;
  const replies = await getThreadReplies(channel, thread, cursor);
  const applied: string[] = [];
  for (const m of replies) {
    if (m.bot_id || (m.subtype && m.subtype !== 'thread_broadcast')) continue;
    const author = parentFromSlackUser(m.user);
    if (!author) continue;
    const claim = parseClaimReply(m.text ?? '', author, open(), SLACK_IDS());
    if (!claim) continue;

    const events = state.events.filter((e) => claim.eventIds.includes(e.id));
    for (const e of events) {
      await assignLogistics(e.id, claim.parent);
      e.assigned_parent = claim.parent;
    }
    const what = events.map((e) => `${fmtTime(e.start_time)} ${esc(e.title)}`).join(', ');
    const tail = open().length ? '' : " That's everything — all pickups covered ✅";
    await postThreadReply(channel, thread, `👍 Got it — *${what}* → ${NAMES[claim.parent]}.${tail}`);
    applied.push(`${what} → ${claim.parent}`);
  }
  if (replies.length) {
    await claimRun(PICKUP_NUDGE.cursorJob, date); // no-op if it already exists
    await saveRunMessage(PICKUP_NUDGE.cursorJob, date, channel, replies[replies.length - 1].ts);
  }
  if (applied.length) await refreshDinnerMessages(date); // re-render nudge + standup buttons

  // ── 3. 4 PM follow-up ────────────────────────────────────────────
  const stillOpen = open();
  let followedUp = false;
  if (stillOpen.length && (forceFollowUp || mins >= PICKUP_NUDGE.followUp())) {
    if (await claimRun(PICKUP_NUDGE.followUpJob, date)) {
      const list = stillOpen.map((e) => `• *${fmtTime(e.start_time)}* ${esc(e.title)}`).join('\n');
      try {
        await postThreadReply(
          channel,
          thread,
          `⏰ It's 4 PM and ${stillOpen.length === 1 ? 'this pickup is' : 'these pickups are'} still unclaimed ${mention('daniela')} ${mention('warren')}\n${list}\nTap a name above or reply here.`,
          true,
        );
        followedUp = true;
      } catch (e) {
        await releaseRun(PICKUP_NUDGE.followUpJob, date);
        throw e;
      }
    }
  }

  return NextResponse.json({ ok: true, repliesRead: replies.length, applied, unclaimed: stillOpen.length, followedUp });
}
