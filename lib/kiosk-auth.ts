import type { NextRequest } from 'next/server';
import { hasBearer, safeEqual } from './auth';
import { kioskCookieName } from './kiosk-cookie';
import { isBetaDevicePath, isPublicHostedBeta } from './beta-deployment';

/** Server-side defense for privileged device routes, independent of middleware. */
export function requireKioskRequest(req: NextRequest, mutation = false): Response | null {
  const token = process.env.KIOSK_ACCESS_TOKEN;
  const publicDevice = isPublicHostedBeta() && isBetaDevicePath(req.nextUrl.pathname);
  const bearer = !publicDevice && hasBearer(req, token);
  if (!publicDevice) {
    if (!token) return Response.json({ error: 'Device access is not configured.' }, { status: 503 });
    const cookie = req.cookies.get(kioskCookieName())?.value;
    if (!bearer && !(cookie && safeEqual(cookie, token))) {
      return Response.json({ error: 'Unlock this device to access groceries and voice.' }, { status: 401 });
    }
  }
  if (mutation) {
    const origin = req.headers.get('origin');
    // Public and cookie-based browser writes need an exact Origin. A native bearer client
    // may omit Origin; a supplied cross-origin value is always refused.
    if ((origin && origin !== req.nextUrl.origin)
      || (!origin && !bearer)
      || req.headers.get('sec-fetch-site') === 'cross-site') {
      return Response.json({ error: 'This request must come from the console.' }, { status: 403 });
    }
  }
  return null;
}
