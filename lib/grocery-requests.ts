import { z } from 'zod';
import { groceryAgentRpc } from './grocery-agent-store';

const text = (max: number) => z.string().trim().max(max).nullable().optional();
export const groceryInput = z.object({
  name: z.string().trim().min(1).max(250), quantity: text(100), notes: text(500),
}).strict();
const identity = { id: z.uuid(), revision: z.number().int().min(1).max(999999999) };
export const groceryAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), operation_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/), items: z.array(groceryInput).min(1).max(20) }).strict(),
  z.object({ action: z.literal('edit'), ...identity, ...groceryInput.shape }).strict(),
  z.object({ action: z.literal('status'), ...identity, status: z.enum(['needed','got','cancelled']) }).strict(),
]);

export class GroceryRequestError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
const errors: Record<string, string> = {
  invalid_input: 'Check the item names, quantities and notes.',
  revision_conflict: 'This request changed. Refresh before editing it.',
  request_missing: 'This request no longer exists. Refresh the list.',
  idempotency_conflict: 'This save was already used with different items. Refresh before trying again.',
};

export async function listGroceryRequests() {
  return groceryAgentRpc('grocery_device_list', {});
}
export async function changeGroceryRequests(input: unknown, addedBy: 'voice' | 'kiosk' = 'kiosk') {
  const parsed = groceryAction.safeParse(input);
  if (!parsed.success) throw new GroceryRequestError('invalid_input', errors.invalid_input);
  const action = parsed.data.action === 'add' ? { ...parsed.data, added_by: addedBy } : parsed.data;
  const result = await groceryAgentRpc('grocery_device_mutate', { p_action: action });
  if (result.ok !== true) {
    const code = typeof result.code === 'string' ? result.code : 'storage_error';
    throw new GroceryRequestError(code, errors[code] ?? 'The grocery request could not be saved.', code === 'revision_conflict' || code === 'idempotency_conflict' ? 409 : 400);
  }
  return result;
}
export async function addGroceryRequests(items: unknown, operationId: string, addedBy: 'voice' | 'kiosk') {
  return changeGroceryRequests({ action: 'add', operation_id: operationId, items }, addedBy);
}
