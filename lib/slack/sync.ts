import { getKitchenState } from '../domain';
import { getRuns } from '../runs';
import { fmtDay } from '../time';
import { updateMessage } from './api';
import { nudgeBlocks, pickupNudgeBlocks, standupBlocks } from './blocks';

/**
 * Re-render today's standup + 2 PM nudge messages from current DB state.
 * Called after ANY change (kiosk tap, voice, Slack click) so Slack never
 * shows stale buttons. Never throws.
 */
export async function refreshDinnerMessages(date: string) {
  try {
    const runs = await getRuns(['daily-standup', 'dinner-nudge', 'pickup-nudge'], date);
    const live = runs.filter((r) => r.slack_channel && r.slack_ts);
    if (!live.length) return;
    const state = await getKitchenState(date);
    for (const r of live) {
      const blocks =
        r.job === 'daily-standup'
          ? standupBlocks(state)
          : r.job === 'pickup-nudge'
            ? pickupNudgeBlocks(state)
            : nudgeBlocks(state);
      await updateMessage(r.slack_channel!, r.slack_ts!, `Kitchen update for ${fmtDay(date)}`, blocks);
    }
  } catch (e) {
    console.error('refreshDinnerMessages failed', e);
  }
}
