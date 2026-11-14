import { NextResponse, type NextRequest } from 'next/server';
import { controlSpotify, getNowPlaying } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getNowPlaying());
  } catch (e) {
    return NextResponse.json({ configured: false, playing: false, error: String(e) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      op: 'play' | 'pause' | 'next' | 'previous';
      query?: string;
      uri?: string;
    };
    const res = await controlSpotify(body);
    const state = await getNowPlaying();
    return NextResponse.json({ ...res, state });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
