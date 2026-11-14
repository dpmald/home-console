import { NextResponse, type NextRequest } from 'next/server';

const COOKIE = 'kiosk_key';

export function middleware(req: NextRequest) {
  const token = process.env.KIOSK_ACCESS_TOKEN;
  if (!token) return NextResponse.next();

  const { pathname, searchParams } = req.nextUrl;
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
  matcher: ['/', '/api/kiosk/:path*', '/api/voice/:path*', '/api/weather'],
};
