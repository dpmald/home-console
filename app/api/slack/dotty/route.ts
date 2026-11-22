import { z } from 'zod';
import { isBetaDeployment } from '@/lib/beta-deployment';
import { readBoundedBody, RequestBodyError } from '@/lib/request-body';
import { verifySlackSignature } from '@/lib/slack/verify';

const challenge = z.object({ type: z.literal('url_verification'), challenge: z.string().min(1) });
const reaction = z.object({
  type: z.literal('event_callback'),
  event: z.object({
    type: z.literal('reaction_added'), reaction: z.string(), user: z.string(),
    item_user: z.string().optional(),
    item: z.object({ type: z.literal('message'), channel: z.string(), ts: z.string().min(1) }),
  }),
});
const workflow = 'https://api.github.com/repos/dpmald/home-console/actions/workflows/dotty-pr-review.yml/dispatches';

export async function POST(req: Request) {
  if (isBetaDeployment() || process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT === '1') {
    return new Response(null, { status: 404 });
  }
  const secret = process.env.DOTTY_SIGNING_SECRET;
  if (!secret) return new Response('Dotty is not configured', { status: 503 });
  let raw: string;
  try { raw = await readBoundedBody(req, 64 * 1024); }
  catch (err) {
    if (err instanceof RequestBodyError) return new Response(null, { status: 413 });
    throw err;
  }
  if (!verifySlackSignature(raw, req.headers, secret)) return new Response(null, { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  const verification = challenge.safeParse(body);
  if (verification.success) return Response.json({ challenge: verification.data.challenge });
  const delivery = reaction.safeParse(body);
  if (!delivery.success) return new Response(null, { status: 200 });
  const { event } = delivery.data;
  const channel = process.env.DOTTY_CHANNEL_ID;
  const approver = process.env.DOTTY_APPROVER_ID;
  const bot = process.env.DOTTY_BOT_USER_ID;
  const token = process.env.DOTTY_REVIEW_DISPATCH_TOKEN;
  if (!channel || !approver || !bot || !token) return new Response('Dotty is not configured', { status: 503 });
  if (event.item.channel !== channel || event.user !== approver || (event.item_user && event.item_user !== bot) ||
      !/^(?:\+1|thumbsup)(?:::skin-tone-[2-6])?$/.test(event.reaction)) return new Response(null, { status: 200 });

  // A signed event only wakes the existing scanner. GitHub checks the live reaction again at merge.
  try {
    const result = await fetch(workflow, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(1800),
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (result.ok) return new Response(null, { status: 200 });
    console.error('Dotty review dispatch returned HTTP', result.status);
  } catch { console.error('Dotty review dispatch did not complete'); }
  // Allow Slack to retry delivery. The scheduled scan also recovers missed events.
  return new Response('Review dispatch unavailable', { status: 503 });
}
