import { NextResponse, type NextRequest } from 'next/server';

import { kioskCookieName } from './lib/kiosk-cookie';
import { isBetaDeployment, isBetaPathAllowed, isPublicHostedBeta } from './lib/beta-deployment';

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const beta = isBetaDeployment();
  const experiment = pathname === '/beta' || pathname.startsWith('/beta/')
    || pathname === '/api/groceries' || pathname === '/api/mcp';
  if ((!beta && experiment) || (beta && !isBetaPathAllowed(pathname))) {
    return new NextResponse('Not found', { status: 404 });
  }
  // MCP uses its dedicated agent credential, never a device cookie.
  if (pathname === '/api/mcp') return NextResponse.next();
  if (isPublicHostedBeta()) {
    if (req.method === 'GET' && req.nextUrl.searchParams.has('key')) {
      const clean = req.nextUrl.clone();
      clean.searchParams.delete('key');
      return NextResponse.redirect(clean, { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
    }
    return NextResponse.next();
  }
  const COOKIE = kioskCookieName();
  const token = process.env.KIOSK_ACCESS_TOKEN;
  if (!token && (beta || pathname.startsWith('/api/groceries') || pathname.startsWith('/api/voice'))) {
    return NextResponse.json({ error: 'Device access is not configured.' }, { status: 503 });
  }
  if (!token) return NextResponse.next();

  const { searchParams } = req.nextUrl;
  // Slack, crons, n8n, and Warren's agent authenticate with their own secrets.
  if (
    pathname.startsWith('/api/slack') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/logistics') ||
    pathname.startsWith('/api/recipes')
  ) {
    return NextResponse.next();
  }

  const keyLogin = searchParams.get('key') === token;
  // The two protected localhost previews share a hostname. On first entry from
  // the kitchen, issue Beta's own cookie for the synthetic grocery list.
  const localKitchenEntry = beta && process.env.NODE_ENV === 'development'
    && process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT === '1'
    && token === 'home-console-groceries-local-only'
    && req.headers.get('host') === 'localhost:3005'
    && pathname === '/beta' && req.method === 'GET' && !req.nextUrl.search
    && req.cookies.get(COOKIE)?.value !== token
    && req.cookies.get('kiosk_key')?.value === 'home-console-local-only';
  if (keyLogin || localKitchenEntry) {
    const clean = req.nextUrl.clone();
    clean.searchParams.delete('key');
    const res = keyLogin ? NextResponse.redirect(clean) : NextResponse.next();
    res.headers.set('Cache-Control', 'private, no-store');
    res.cookies.set(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 365 * 86_400,
    });
    return res;
  }

  if (req.cookies.get(COOKIE)?.value === token) return NextResponse.next();
  if (req.headers.get('authorization') === `Bearer ${token}`) return NextResponse.next();

  if (beta && process.env.NODE_ENV === 'production' && req.method === 'GET'
      && (pathname === '/' || pathname === '/beta' || pathname.startsWith('/beta/') || pathname === '/guide')) {
    return NextResponse.redirect(new URL('/unlock', req.url), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  return new NextResponse('Locked — open /?key=YOUR_KIOSK_ACCESS_TOKEN once on this device.', { status: 401 });
}

export const config = {
  matcher: ['/', '/guide', '/beta/:path*', '/api/:path*'],
};
