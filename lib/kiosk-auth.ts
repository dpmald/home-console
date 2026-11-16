import type { NextRequest } from 'next/server';
import { hasBearer, safeEqual } from './auth';

/** Server-side defense for privileged device routes, independent of middleware. */
export function requireKioskRequest(req: NextRequest, mutation = false): Response | null {
  const token = process.env.KIOSK_ACCESS_TOKEN;
  if (!token) return Response.json({ error: 'Device access is not configured.' }, { status: 503 });
  const cookie = req.cookies.get('kiosk_key')?.value;
  if (!(cookie && safeEqual(cookie, token)) && !hasBearer(req, token)) {
    return Response.json({ error: 'Unlock this device to access groceries and voice.' }, { status: 401 });
  }
  if (mutation) {
    const origin = req.headers.get('origin');
    // Cookie-based browser writes need an exact Origin. A native bearer client
    // may omit Origin; a supplied cross-origin value is always refused.
    if ((origin && origin !== req.nextUrl.origin)
      || (!origin && !hasBearer(req, token))
      || req.headers.get('sec-fetch-site') === 'cross-site') {
      return Response.json({ error: 'This request must come from the console.' }, { status: 403 });
    }
  }
  return null;
}
