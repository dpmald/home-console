/** Bounded data passed by the voice model. It cannot supply the device identity. */
export class VoiceInputError extends Error {}

export interface GroceryVoiceItem {
  name: string;
  quantity: string | null;
  notes: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseVoiceRequest(value: unknown) {
  if (!record(value) || typeof value.name !== 'string' || !/^[a-z_]{1,64}$/.test(value.name)
    || (value.args !== undefined && !record(value.args))
    || Object.keys(value).some((key) => !['name', 'args', 'call_id'].includes(key))) {
    throw new VoiceInputError('That voice request could not be understood. Please try again.');
  }
  if (value.call_id !== undefined
    && (typeof value.call_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.call_id))) {
    throw new VoiceInputError('That voice request could not be identified. Please try again.');
  }
  return { name: value.name, args: (value.args ?? {}) as Record<string, unknown>, callId: value.call_id as string | undefined };
}

function text(value: unknown, maximum: number, required = false): string | null {
  if (!required && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) {
    throw new VoiceInputError('Please use an item name, a short quantity, and an optional note.');
  }
  return value.trim() || null;
}

export function parseGroceryVoiceItems(name: string, args: Record<string, unknown>): GroceryVoiceItem[] {
  const items = name === 'add_grocery_item' ? [args] : args.items;
  if (name !== 'add_grocery_item' && Object.keys(args).some((key) => key !== 'items')) {
    throw new VoiceInputError('Please provide grocery items only.');
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new VoiceInputError('Please add between one and twenty grocery items at a time.');
  }
  return items.map((item) => {
    if (!record(item) || Object.keys(item).some((key) => !['name', 'quantity', 'notes'].includes(key))) {
      throw new VoiceInputError('Please provide an item name, quantity, and optional note.');
    }
    return { name: text(item.name, 250, true)!, quantity: text(item.quantity, 100), notes: text(item.notes, 500) };
  });
}

export function voiceResultSucceeded(value: unknown): boolean {
  return record(value) && value.ok === true && !value.error;
}

/** Keep each tool result small enough for the Realtime data channel. */
export function voicePage<T>(rows: T[], offset: unknown) {
  const start = offset === undefined ? 0 : offset;
  if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0) {
    throw new VoiceInputError('Please request a valid list offset.');
  }
  const page = rows.slice(start, start + 15);
  return { page, total: rows.length, next_offset: start + page.length < rows.length ? start + page.length : null };
}
