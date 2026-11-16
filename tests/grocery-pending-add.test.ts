import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearPendingGroceryAdd, loadPendingGroceryAdd, parsePendingGroceryAdd,
  PENDING_GROCERY_ADD_KEY, storePendingGroceryAdd, type PendingAddStorage, type PendingGroceryAdd } from '../lib/grocery-pending-add';

const items = [{ name: 'Synthetic test milk', quantity: '2 cartons', notes: null }];
const pending: PendingGroceryAdd = {
  operationId: '00000000-0000-4000-8000-000000000101', signature: JSON.stringify(items), items,
};
const memoryStorage = (): PendingAddStorage => {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); } };
};

test('an unconfirmed save restores the same operation and exact payload after a new mount', () => {
  const storage = memoryStorage();
  assert.equal(storePendingGroceryAdd(storage, pending), true);
  const restored = loadPendingGroceryAdd(storage);
  assert.deepEqual(restored, pending);
  // Reading and polling must not consume a recovery record before acknowledgement.
  assert.deepEqual(loadPendingGroceryAdd(storage), pending);
  assert.equal(clearPendingGroceryAdd(storage, pending.operationId), true);
  assert.equal(loadPendingGroceryAdd(storage), null);
});

test('a late acknowledgement cannot clear a newer pending save', () => {
  const storage = memoryStorage();
  const newer = { ...pending, operationId: '00000000-0000-4000-8000-000000000102' };
  storePendingGroceryAdd(storage, newer);
  assert.equal(clearPendingGroceryAdd(storage, pending.operationId), true);
  assert.deepEqual(loadPendingGroceryAdd(storage), newer);
});

test('recovery rejects malformed, oversized, altered and unexpected data', () => {
  const invalid = [
    'not json', ' '.repeat(48_001), JSON.stringify({ ...pending, operationId: 'wrong' }),
    JSON.stringify({ ...pending, signature: 'altered payload' }),
    JSON.stringify({ ...pending, secret: 'unexpected field' }),
    JSON.stringify({ ...pending, items: [] }),
    JSON.stringify({ ...pending, items: Array(21).fill(items[0]) }),
    JSON.stringify({ ...pending, items: [{ ...items[0], name: 'x'.repeat(251) }] }),
    JSON.stringify({ ...pending, items: [{ ...items[0], quantity: { instruction: 'invalid' } }] }),
  ];
  for (const raw of invalid) assert.equal(parsePendingGroceryAdd(raw), null);
  const storage = memoryStorage();
  storage.setItem(PENDING_GROCERY_ADD_KEY, invalid[0]);
  assert.equal(loadPendingGroceryAdd(storage), null);
  assert.equal(storage.getItem(PENDING_GROCERY_ADD_KEY), null);
});

test('blocked or full storage does not throw or discard the caller memory copy', () => {
  const denied: PendingAddStorage = {
    getItem() { throw new Error('storage denied'); },
    setItem() { throw new Error('storage full'); },
    removeItem() { throw new Error('storage denied'); },
  };
  assert.equal(loadPendingGroceryAdd(denied), null);
  assert.equal(storePendingGroceryAdd(denied, pending), false);
  assert.equal(clearPendingGroceryAdd(denied, pending.operationId), false);
  assert.equal(storePendingGroceryAdd(null, pending), false);
  assert.equal(pending.operationId, '00000000-0000-4000-8000-000000000101');
  assert.deepEqual(pending.items, items);
});
