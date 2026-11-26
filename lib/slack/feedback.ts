import { createHash } from 'node:crypto';
import { z } from 'zod';
import { VoiceInputError } from '../voice/request';
import { CHANNELS, slackApi } from './api';

const feedback = z.strictObject({
  recipient: z.enum(['codex', 'gemini']),
  kind: z.enum(['bug', 'feature']),
  title: z.string().trim().min(1).max(120),
  details: z.string().trim().min(1).max(2000),
});

export async function postDeveloperFeedback(callId: string, args: Record<string, unknown>) {
  const parsed = feedback.safeParse(args);
  if (!parsed.success) throw new VoiceInputError('Choose a recipient and include a short title and description.');
  const { recipient, kind, title, details } = parsed.data;
  const channel = CHANNELS.backlog();
  const owner = recipient === 'gemini' ? 'Gemini (Daniela)' : 'Codex (Warren)';
  const label = kind === 'bug' ? 'Bug' : 'Feature request';
  const message = [`Home Console backlog · ${label} · ${owner}`, title, details].join('\n');
  // The same Realtime tool call carries the same client message ID on a retry.
  const urlNamespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
  const bytes = createHash('sha1').update(urlNamespace).update('urn:home-console:slack-feedback:' + callId).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  const clientId = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  const result = await slackApi('chat.postMessage', {
    channel, client_msg_id: clientId,
    text: message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    mrkdwn: false, parse: 'none', link_names: false, unfurl_links: false, unfurl_media: false,
  }, AbortSignal.timeout(10000));
  if (result.ok !== true || typeof result.channel !== 'string' || !/^[CG][A-Z0-9]+$/.test(result.channel)
      || (/^[CG][A-Z0-9]+$/.test(channel) && result.channel !== channel)
      || typeof result.ts !== 'string' || !/^\d+\.\d+$/.test(result.ts)) return null;
  return { ok: true, recipient, kind, channel: result.channel, ts: result.ts };
}
