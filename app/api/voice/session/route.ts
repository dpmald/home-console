import { NextResponse, type NextRequest } from 'next/server';
import { VOICE_TOOLS } from '@/lib/voice/tools';
import { fmtDay, todayISO } from '@/lib/time';

export const dynamic = 'force-dynamic';

function buildSessionConfig() {
  const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime';
  const voice = process.env.OPENAI_REALTIME_VOICE || 'marin';
  const instructions = [
    `You are the kitchen voice assistant on a wall console for Daniela, Warren, and their kid Wesley. Today is ${fmtDay(todayISO())}.`,
    'People speak to you from 5–8 feet away while cooking or walking by. Keep every answer to 1–2 crisp sentences — no filler, no markdown.',
    'Before answering questions about dinner, the fridge, chores, or schedules, call get_today_overview so you never guess.',
    'When asked to change something ("Warren is cooking the pasta tonight", "add paper towels to the cart", "mark the salmon cooked", "I can\'t cook tonight", "Daniela has the dentist pickup", "set a 12 minute timer", "play NPR"), call the matching tool immediately and confirm in one short sentence.',
    'When the user says thanks / that\'s all / stop, say a quick goodbye and call end_session.',
  ].join('\n');

  return {
    type: 'realtime',
    model,
    instructions,
    audio: {
      input: { turn_detection: { type: 'server_vad', silence_duration_ms: 700 } },
      output: { voice },
    },
    tools: VOICE_TOOLS,
    tool_choice: 'auto',
  };
}

/**
 * WebRTC unified interface: browser POSTs its SDP offer here; we forward it to
 * OpenAI with the session config and return the SDP answer. OPENAI_API_KEY never
 * leaves the server.
 */
export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: 'OPENAI_API_KEY is not set' }, { status: 503 });

  const sdp = await req.text();
  const fd = new FormData();
  fd.set('sdp', sdp);
  fd.set('session', JSON.stringify(buildSessionConfig()));

  const r = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  });

  if (!r.ok) {
    return NextResponse.json({ error: await r.text() }, { status: r.status });
  }
  return new NextResponse(await r.text(), {
    status: 200,
    headers: { 'Content-Type': 'application/sdp' },
  });
}
