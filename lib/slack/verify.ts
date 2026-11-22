import crypto from 'node:crypto';
import { safeEqual } from '../auth';

/** Verifies Slack's v0 request signature (rejects anything > 5 min old). */
export function verifySlackSignature(rawBody: string, headers: Headers, secret = process.env.SLACK_SIGNING_SECRET): boolean {
  const ts = headers.get('x-slack-request-timestamp');
  const sig = headers.get('x-slack-signature');
  if (!secret || !ts || !/^\d+$/.test(ts) || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex');
  return safeEqual(expected, sig);
}
