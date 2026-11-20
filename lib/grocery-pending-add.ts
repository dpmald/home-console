/** Per-tab recovery of an unconfirmed grocery addition. Contains item data only,
 * never a bearer credential; a restored submission is never sent automatically. */
export interface PendingGroceryItem { name: string; quantity: string | null; notes: string | null }
export interface PendingGroceryAdd {
  operationId: string;
  signature: string;
  items: PendingGroceryItem[];
}
export type PendingAddStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const PENDING_GROCERY_ADD_KEY = 'home-console:grocery-pending-add:v1';
const MAX_STORED_CHARACTERS = 48_000;

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value;
}

export function parsePendingGroceryAdd(raw: string | null): PendingGroceryAdd | null {
  if (!raw || raw.length > MAX_STORED_CHARACTERS) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const saved = value as Record<string, unknown>;
    if (Object.keys(saved).some((key) => !['operationId', 'signature', 'items'].includes(key))
      || typeof saved.operationId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.operationId)
      || typeof saved.signature !== 'string'
      || !Array.isArray(saved.items) || saved.items.length < 1 || saved.items.length > 20) return null;
    const items: PendingGroceryItem[] = [];
    for (const candidate of saved.items) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
      const item = candidate as Record<string, unknown>;
      if (Object.keys(item).some((key) => !['name', 'quantity', 'notes'].includes(key))
        || !boundedText(item.name, 250)
        || !(item.quantity === null || boundedText(item.quantity, 100))
        || !(item.notes === null || boundedText(item.notes, 500))) return null;
      items.push({ name: item.name, quantity: item.quantity, notes: item.notes });
    }
    if (saved.signature !== JSON.stringify(items)) return null;
    return { operationId: saved.operationId, signature: saved.signature, items };
  } catch { return null; }
}

export function loadPendingGroceryAdd(storage: PendingAddStorage | null): PendingGroceryAdd | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PENDING_GROCERY_ADD_KEY);
    const pending = parsePendingGroceryAdd(raw);
    if (raw && !pending) storage.removeItem(PENDING_GROCERY_ADD_KEY);
    return pending;
  } catch { return null; }
}

export function storePendingGroceryAdd(storage: PendingAddStorage | null, pending: PendingGroceryAdd): boolean {
  if (!storage) return false;
  try {
    const raw = JSON.stringify(pending);
    if (!parsePendingGroceryAdd(raw)) return false;
    storage.setItem(PENDING_GROCERY_ADD_KEY, raw);
    return true;
  } catch { return false; }
}

export function clearPendingGroceryAdd(storage: PendingAddStorage | null, operationId: string): boolean {
  if (!storage) return false;
  try {
    const current = parsePendingGroceryAdd(storage.getItem(PENDING_GROCERY_ADD_KEY));
    // An older response must not remove a newer submission's recovery record.
    if (current && current.operationId !== operationId) return true;
    storage.removeItem(PENDING_GROCERY_ADD_KEY);
    return true;
  } catch { return false; }
}
