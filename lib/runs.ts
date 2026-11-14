import { db, unwrap } from './supabase/server';

export interface BotRun {
  job: string;
  run_key: string;
  slack_channel: string | null;
  slack_ts: string | null;
}

/** Returns true if this (job, key) had not run yet and is now claimed. */
export async function claimRun(job: string, key: string): Promise<boolean> {
  const rows = unwrap<BotRun[]>(
    await db()
      .from('bot_runs')
      .upsert({ job, run_key: key }, { onConflict: 'job,run_key', ignoreDuplicates: true })
      .select(),
    'claim run',
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function releaseRun(job: string, key: string) {
  await db().from('bot_runs').delete().eq('job', job).eq('run_key', key);
}

export async function saveRunMessage(job: string, key: string, channel: string, ts: string) {
  unwrap(
    await db().from('bot_runs').update({ slack_channel: channel, slack_ts: ts }).eq('job', job).eq('run_key', key),
    'save run message',
  );
}

export async function getRuns(jobs: string[], key: string): Promise<BotRun[]> {
  return unwrap<BotRun[]>(
    await db().from('bot_runs').select('*').in('job', jobs).eq('run_key', key),
    'get runs',
  );
}
