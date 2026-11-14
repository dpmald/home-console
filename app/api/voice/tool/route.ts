import { after, NextResponse, type NextRequest } from 'next/server';
import { afterVoiceTool, executeVoiceTool } from '@/lib/voice/execute';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { name, args } = (await req.json()) as { name: string; args?: Record<string, unknown> };
  try {
    const { result, touchedDinner } = await executeVoiceTool(name, args ?? {});
    after(() => afterVoiceTool(touchedDinner));
    return NextResponse.json({ result });
  } catch (e) {
    console.error('voice tool error', name, e);
    return NextResponse.json({ result: { error: String(e) } });
  }
}
