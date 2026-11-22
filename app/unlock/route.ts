import { NextResponse, type NextRequest } from 'next/server';
import { readBoundedBody } from '@/lib/request-body';
import { safeEqual } from '@/lib/auth';
import { isBetaDeployment, isPublicHostedBeta } from '@/lib/beta-deployment';
import { kioskCookieName } from '@/lib/kiosk-cookie';

export const dynamic = 'force-dynamic';

function form(failed = false) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>Unlock Beta kitchen</title>
    <style>body{font:18px system-ui;color:#322922;background:#faf9f5;margin:0}main{max-width:25rem;margin:12vh auto;padding:2rem}label,input,button{display:block}input,button{box-sizing:border-box;width:100%;padding:.9rem;margin:.6rem 0 1.2rem;border-radius:.65rem;font:inherit}button{border:0;background:#a63822;color:white;font-weight:bold}</style>
    <main><h1>Unlock Beta kitchen</h1><form method="post" action="/unlock"><label for="key">Beta device key</label>
    <input id="key" name="key" type="password" required autocomplete="current-password" maxlength="256">
    ${failed ? '<p role="alert">That key did not unlock the Beta kitchen.</p>' : ''}
    <button>Unlock this device</button></form></main></html>`, {
    status: failed ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" },
  });
}

function unlockRedirectOrError() {
  if (!isBetaDeployment() || process.env.NODE_ENV !== 'production') return new Response(null, { status: 404 });
  if (isPublicHostedBeta()) return new Response(null, { status: 303, headers: { Location: '/beta', 'Cache-Control': 'no-store' } });
  if (!process.env.KIOSK_ACCESS_TOKEN) return new Response('Beta device access is unavailable.', { status: 503 });
}

export function GET() { return unlockRedirectOrError() ?? form(); }

export async function POST(req: NextRequest) {
  const blocked = unlockRedirectOrError();
  if (blocked) return blocked;
  if (req.headers.get('origin') !== req.nextUrl.origin) return new Response(null, { status: 403 });
  if (!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return form(true);
  let key: string | null;
  try { key = new URLSearchParams(await readBoundedBody(req, 1024)).get('key'); }
  catch { return form(true); }
  if (typeof key !== 'string' || key.length > 256 || !safeEqual(key, process.env.KIOSK_ACCESS_TOKEN!)) return form(true);
  const response = NextResponse.redirect(new URL('/beta', req.url), 303);
  response.headers.set('Cache-Control', 'private, no-store');
  response.cookies.set(kioskCookieName(), key, {
    secure: true, httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 86400,
  });
  return response;
}
