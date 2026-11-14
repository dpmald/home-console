import { NAMES } from '../family';
import type { Parent } from '../types';

export async function slackApi(method: string, body: Record<string, unknown>): Promise<any> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN missing');
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Slack ${method} failed: ${j.error}`);
  return j;
}

/** Returns { channel (ID), ts } so the message can be updated later. */
export async function postMessage(channel: string, text: string, blocks?: unknown[]) {
  const j = await slackApi('chat.postMessage', { channel, text, blocks, unfurl_links: false });
  return { channel: j.channel as string, ts: j.ts as string };
}

export async function updateMessage(channel: string, ts: string, text: string, blocks?: unknown[]) {
  await slackApi('chat.update', { channel, ts, text, blocks });
}

const SLACK_IDS = (): Record<Parent, string | undefined> => ({
  daniela: process.env.SLACK_USER_DANIELA,
  warren: process.env.SLACK_USER_WARREN,
});

export function mention(p: Parent): string {
  const id = SLACK_IDS()[p];
  return id ? `<@${id}>` : NAMES[p];
}

export function parentFromSlackUser(userId: string | undefined): Parent | null {
  if (!userId) return null;
  const ids = SLACK_IDS();
  if (ids.daniela === userId) return 'daniela';
  if (ids.warren === userId) return 'warren';
  return null;
}

export const CHANNELS = {
  logistics: () => process.env.SLACK_CHANNEL_LOGISTICS || '#logistics',
  food: () => process.env.SLACK_CHANNEL_FOOD || '#food',
  chores: () => process.env.SLACK_CHANNEL_CHORES || process.env.SLACK_CHANNEL_LOGISTICS || '#logistics',
};
