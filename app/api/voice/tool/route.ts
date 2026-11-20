import { after, NextResponse, type NextRequest } from 'next/server';
import { afterVoiceTool, executeVoiceTool } from '@/lib/voice/execute';
import { CLIENT_TOOL_NAMES, GROCERY_VOICE_TOOL_NAMES, VOICE_TOOLS } from '@/lib/voice/tools';
import { parseGroceryVoiceItems, parseVoiceRequest, VoiceInputError, voiceResultSucceeded } from '@/lib/voice/request';
import { addGroceryRequests, GroceryRequestError, listGroceryRequests } from '@/lib/grocery-requests';
import { requireKioskRequest } from '@/lib/kiosk-auth';
import { readBoundedBody, RequestBodyError } from '@/lib/request-body';

export const dynamic = 'force-dynamic';
const MAX_BODY = 32 * 1024;
const SERVER_TOOL_NAMES = new Set(VOICE_TOOLS.map((tool) => tool.name).filter((name) => !CLIENT_TOOL_NAMES.has(name)));
const failure = (error: string, status: number) => NextResponse.json({ result: { ok: false, error } }, { status });

export async function POST(req: NextRequest) {
  const denied = requireKioskRequest(req, true);
  if (denied) return denied;
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return failure('Please send a valid voice request.', 415);
  }
  try {
    const body = await readBoundedBody(req, MAX_BODY);
    let json: unknown;
    try { json = JSON.parse(body); } catch { return failure('That voice request could not be understood.', 400); }
    const { name, args, callId } = parseVoiceRequest(json);
    if (!SERVER_TOOL_NAMES.has(name)
      || (process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT === '1' && !GROCERY_VOICE_TOOL_NAMES.has(name))) {
      return failure('That action is not available here.', 400);
    }
    if (name === 'add_grocery_items' || name === 'add_grocery_item') {
      if (!callId) return failure('That voice request could not be identified. Please try again.', 400);
      const result = await addGroceryRequests(parseGroceryVoiceItems(name, args), `voice:${callId}`, 'voice');
      return NextResponse.json({ result: { ...result, note: "Saved to Saturday's list. Checkout remains manual." } });
    }
    if (name === 'get_grocery_requests') {
      if (Object.keys(args).length) return failure('This action does not accept extra instructions.', 400);
      return NextResponse.json({ result: { ok: true, ...await listGroceryRequests() } });
    }
    const { result, touchedDinner } = await executeVoiceTool(name, args);
    if (!voiceResultSucceeded(result)) return failure('The action was not completed. Please check the screen and try again.', 400);
    if (touchedDinner) after(() => afterVoiceTool(true));
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof RequestBodyError) return failure('That voice request is too long.', error.status);
    if (error instanceof VoiceInputError) return failure(error.message, 400);
    if (error instanceof GroceryRequestError) return failure(error.message, error.status);
    // Database and provider exceptions can contain private text; do not echo or log them.
    return failure('The request could not be completed. Please check the list before trying again.', 503);
  }
}
