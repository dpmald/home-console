import { NextResponse } from 'next/server';
import { getWeather } from '@/lib/weather';

export async function GET() {
  try {
    return NextResponse.json(await getWeather());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
