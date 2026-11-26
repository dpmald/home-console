import { after, NextResponse, type NextRequest } from 'next/server';
import { afterVoiceTool, executeVoiceTool } from '@/lib/voice/execute';
import { CLIENT_TOOL_NAMES, GROCERY_VOICE_TOOL_NAMES, VOICE_TOOLS } from '@/lib/voice/tools';
import { parseGroceryVoiceItems, parseVoiceRequest, VoiceInputError, voicePage, voiceResultSucceeded } from '@/lib/voice/request';
import { changeGroceryRequests, groceryAction, GroceryRequestError, listGroceryRequests } from '@/lib/grocery-requests';
import { requireKioskRequest } from '@/lib/kiosk-auth';
import { readBoundedBody, RequestBodyError } from '@/lib/request-body';
import { getBetaDestination } from '@/lib/beta-navigation.mjs';

export const dynamic = 'force-dynamic';
const MAX_BODY = 32 * 1024;
const serverTools = new Map(VOICE_TOOLS.filter((tool) => !CLIENT_TOOL_NAMES.has(tool.name)).map((tool) => [tool.name, tool]));
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
    const tool = serverTools.get(name);
    if (!tool
      || (process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT === '1' && !GROCERY_VOICE_TOOL_NAMES.has(name))) {
      return failure('That action is not available here.', 400);
    }
    if (Object.keys(args).some((key) => !Object.hasOwn(tool.parameters.properties, key))) {
      return failure('This action does not accept extra instructions.', 400);
    }
    if (GROCERY_VOICE_TOOL_NAMES.has(name)) {
      const reading = name === 'get_grocery_requests';
      const adding = name === 'add_grocery_item' || name === 'add_grocery_items';
      if (!reading && !callId) return failure('That voice request could not be identified. Please try again.', 400);
      let action;
      if (adding) {
        action = { action: 'add' as const, operation_id: `voice:${callId}`, items: parseGroceryVoiceItems(name, args) };
      } else if (!reading) {
        const parsed = groceryAction.safeParse({ action: 'status', ...args });
        if (!parsed.success || parsed.data.action !== 'status' || parsed.data.status === 'needed') {
          return failure('Read the shared list and choose a current request to cancel or mark received.', 400);
        }
        action = parsed.data;
      }
      const synthetic = process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT === '1';
      let result;
      if (synthetic) {
        result = action ? await changeGroceryRequests(action, 'voice') : await listGroceryRequests();
      } else {
        const shared = new URL('https://home-console-beta.vercel.app/api/groceries');
        const beta = getBetaDestination(process.env, req.nextUrl.hostname);
        const key = process.env.HOME_CONSOLE_SHARED_GROCERY_DEVICE_KEY;
        if (!key || !beta || new URL(beta).origin !== shared.origin) {
          return failure('Open Shared grocery list in Dinner Hub to enter or check your request.', 503);
        }
        const response = await fetch(shared, { method: action ? 'POST' : 'GET', body: action && JSON.stringify(action),
          redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
        if (!response.ok) return failure('The shared grocery list could not confirm this request. Check the list before retrying.', response.status === 409 ? 409 : 503);
        result = await response.json();
      }
      if (result?.ok !== true || !Array.isArray(result.items)) {
        return failure('The shared grocery list returned an incomplete result. Check the list before retrying.', 503);
      }
      if (action?.action === 'add') {
        if (!Array.isArray(result.added_ids) || result.added_ids.length !== action.items.length) return failure('The grocery save was not confirmed.', 503);
        return NextResponse.json({ result: { ok: true, added_ids: result.added_ids, note: synthetic ? 'Saved to the test grocery list.' : 'Saved to the shared grocery list.' } });
      }
      if (action?.action === 'status') {
        if (!result.items.some((item: { id?: string; status?: string } | null) =>
          item && item.id === action.id && item.status === action.status)) {
          return failure('The new grocery status was not confirmed.', 503);
        }
        return NextResponse.json({ result: { ok: true, status: action.status, id: action.id } });
      }
      if (args.search !== undefined && (typeof args.search !== 'string' || args.search.length > 250)) {
        return failure('Use a short grocery item name to search the list.', 400);
      }
      const search = args.search?.trim().toLowerCase();
      const items = search ? result.items.filter((item: { name: string }) => item.name.toLowerCase().includes(search)) : result.items;
      const { page, total, next_offset } = voicePage(items, args.offset);
      return NextResponse.json({ result: { ok: true, items: page, total, next_offset } });
    }
    const { result, touchedDinner } = await executeVoiceTool(name, args);
    if (result && typeof result === 'object' && 'needs_clarification' in result && result.needs_clarification === true) {
      return NextResponse.json({ result });
    }
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
