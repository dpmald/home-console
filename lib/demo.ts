import type { KitchenState } from '@/lib/types';

/** Clean empty initial state when Supabase is not yet connected or has no rows for today. */
export function demoKitchenState(date: string): KitchenState {
  return {
    date,
    dinner: {
      date,
      chef: 'unclaimed',
      recipe_name: null,
      linked_backlog_id: null,
      status: 'unclaimed',
      unavailable: [],
      claimed_via: null,
    },
    backlog: [],
    chores: [],
    events: [],
    conflicts: [],
    groceries: [],
    lateTonight: [],
    orders: [],
  };
}
