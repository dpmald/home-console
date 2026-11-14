import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

/**
 * One-time helper to get SPOTIFY_REFRESH_TOKEN:
 * 1. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.local
 * 2. Add http://localhost:3000/api/spotify/auth (or your Vercel URL) as a Redirect URI
 *    in https://developer.spotify.com/dashboard
 * 3. Visit /api/spotify/auth in your browser -> approve -> copy SPOTIFY_REFRESH_TOKEN.
 */
export async function GET(req: NextRequest) {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    return NextResponse.json(
      { error: 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.local first.' },
      { status: 400 },
    );
  }

  const redirectUri = `${req.nextUrl.origin}/api/spotify/auth`;
  const code = req.nextUrl.searchParams.get('code');

  if (!code) {
    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.searchParams.set('client_id', id);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', SCOPES);
    return NextResponse.redirect(authUrl);
  }

  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  const j = await r.json();
  return new NextResponse(
    `Paste this into your .env.local and Vercel environment variables:\n\nSPOTIFY_REFRESH_TOKEN=${j.refresh_token || JSON.stringify(j)}\n`,
    { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
