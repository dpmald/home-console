import { NextResponse, type NextRequest } from 'next/server';

import { kioskCookieName } from './lib/kiosk-cookie';
import { isBetaDeployment, isBetaPathAllowed } from './lib/beta-deployment';

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

  // Visiting /?key=TOKEN once sets a 1-year HttpOnly cookie and strips ?key from the URL.
  if (searchParams.get('key') === token) {
    const clean = req.nextUrl.clone();
    clean.searchParams.delete('key');
    const res = NextResponse.redirect(clean);
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

  return new NextResponse('Locked — open /?key=YOUR_KIOSK_ACCESS_TOKEN once on this device.', { status: 401 });
}

export const config = {
  matcher: ['/', '/guide', '/beta/:path*', '/api/:path*'],
};
