import { fmtTime } from '@/lib/time';
import type { KitchenState } from '@/lib/types';

/** Rich demo state so the 24" Cozyla layout can be previewed before Supabase is wired up. */
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
    backlog: [
      {
        id: 'demo-salmon',
        recipe_or_item_name: 'Miso Glazed Salmon & Bok Choy',
        key_perishables: ['salmon fillets', 'baby bok choy', 'scallions'],
        location: 'fridge',
        delivery_date: date,
        status: 'in_fridge',
        added_by: "Warren's Sat cart",
      },
      {
        id: 'demo-pasta',
        recipe_or_item_name: 'Lemon Ricotta Orecchiette with Peas',
        key_perishables: ['ricotta', 'fresh basil', 'snap peas'],
        location: 'fridge',
        delivery_date: '2026-11-09',
        status: 'in_fridge',
        added_by: "Warren's Sat cart",
      },
    ],
    chores: [
      { id: 'c1', chore_title: 'Make bed', emoji: '🛏️', chore_date: date, completed: true, completed_at: new Date().toISOString(), verified_in_greenlight: false },
      { id: 'c2', chore_title: 'Clear plate after dinner', emoji: '🍽️', chore_date: date, completed: false, completed_at: null, verified_in_greenlight: false },
      { id: 'c3', chore_title: 'Pack backpack for tomorrow', emoji: '🎒', chore_date: date, completed: false, completed_at: null, verified_in_greenlight: false },
      { id: 'c4', chore_title: 'Tidy bedroom', emoji: '🧸', chore_date: date, completed: true, completed_at: new Date().toISOString(), verified_in_greenlight: false },
    ],
    events: [
      {
        id: 'e1',
        external_event_id: 'gcal:1',
        source_calendar: 'daniela_google',
        title: 'Wesley Pediatric Dentist Checkup',
        start_time: `${date}T15:30:00-05:00`,
        end_time: `${date}T16:30:00-05:00`,
        logistics_type: 'appointment',
        assigned_parent: 'daniela',
      },
      {
        id: 'e2',
        external_event_id: 'outlook:2',
        source_calendar: 'warren_outlook',
        title: 'Pick up Wesley from soccer practice',
        start_time: `${date}T17:15:00-05:00`,
        end_time: `${date}T17:45:00-05:00`,
        logistics_type: 'pickup',
        assigned_parent: 'unassigned',
      },
      {
        id: 'e3',
        external_event_id: 'outlook:3',
        source_calendar: 'warren_outlook',
        title: 'Late office — Q4 partner review',
        start_time: `${date}T18:00:00-05:00`,
        end_time: `${date}T19:30:00-05:00`,
        logistics_type: 'late_office',
        assigned_parent: 'warren',
      },
    ],
    conflicts: [
      {
        eventId: 'e2',
        kind: 'unassigned',
        message: `${fmtTime(`${date}T17:15:00-05:00`)} Pick up Wesley from soccer practice has no owner`,
      },
    ],
    groceries: [
      { id: 'g1', name: 'Paper towels', quantity: '6-pack', status: 'needed', added_by: 'voice' },
      { id: 'g2', name: 'Oat milk', quantity: '2 cartons', status: 'needed', added_by: 'kiosk' },
    ],
    lateTonight: [
      { parent: 'warren', title: 'Late office — Q4 partner review', until: `${date}T19:30:00-05:00` },
    ],
    orders: [
      {
        id: 'ord-demo',
        delivery_date: date,
        status: 'pending',
        target_meal_count: 4,
        kept_recipes: [
          { name: 'Sheet-Pan Harissa Chicken Thighs', perishables: ['chicken thighs', 'cauliflower'] },
          { name: 'Crispy Black Bean Tacos', perishables: ['avocado', 'cilantro', 'limes'] },
        ],
        dropped_recipes: [{ name: 'Thai Green Curry' }, { name: 'Mushroom Risotto' }],
        items: [
          { name: 'Chicken thighs', quantity: '2 lb', source: 'Sheet-Pan Harissa Chicken Thighs' },
          { name: 'Cauliflower', quantity: '1 head', source: 'Sheet-Pan Harissa Chicken Thighs' },
          { name: 'Avocados', quantity: '3', source: 'Crispy Black Bean Tacos' },
          { name: 'Paper towels', quantity: '6-pack', source: 'household' },
        ],
        skipped_items: [{ name: 'Scallions', reason: 'already have scallions' }],
        backlog_snapshot: [],
        grocery_item_ids: ['g1'],
        slack_channel: null,
        slack_ts: null,
        decided_by: null,
        decided_at: null,
        created_at: new Date().toISOString(),
      },
    ],
  };
}
