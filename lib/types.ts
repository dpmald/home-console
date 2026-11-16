export type Parent = 'daniela' | 'warren';
export type Chef = Parent | 'takeout' | 'unclaimed';
export type DinnerStatus = 'unclaimed' | 'planned' | 'cooked';
export type BacklogStatus = 'in_fridge' | 'cooked' | 'discarded';
export type BacklogLocation = 'fridge' | 'pantry' | 'freezer';
export type SourceCalendar = 'warren_outlook' | 'daniela_google' | 'family_google' | 'manual';
export type LogisticsType = 'pickup' | 'appointment' | 'late_office' | 'general';
export type Assignee = Parent | 'unassigned';

export interface DinnerRow {
  date: string;
  chef: Chef;
  recipe_name: string | null;
  linked_backlog_id: string | null;
  status: DinnerStatus;
  unavailable: Parent[];
  claimed_via: string | null;
}

export interface BacklogItem {
  id: string;
  recipe_or_item_name: string;
  key_perishables: string[];
  location: BacklogLocation;
  delivery_date: string;
  status: BacklogStatus;
  added_by: string | null;
}

export interface Chore {
  id: string;
  chore_title: string;
  emoji: string | null;
  chore_date: string;
  category?: 'allowance' | 'pay_per_chore';
  reward_cents?: number;
  completed: boolean;
  completed_at: string | null;
  verified_in_greenlight: boolean;
}

export interface LogisticsEvent {
  id: string;
  external_event_id: string;
  source_calendar: SourceCalendar;
  title: string;
  start_time: string;
  end_time: string;
  logistics_type: LogisticsType;
  assigned_parent: Assignee;
  description?: string | null;
}

export interface GroceryItem {
  id: string;
  name: string;
  quantity: string | null;
  status: 'needed' | 'ordered' | 'got' | 'in_cart' | 'needs_attention' | 'cancelled';
  added_by: string | null;
  revision?: number;
  notes?: string | null;
}

export interface Conflict {
  eventId: string | null;
  kind: 'clash' | 'unassigned' | 'dinner';
  message: string;
}

export interface ProposedRecipe {
  name: string;
  ingredients?: { name: string; quantity?: string }[];
  perishables?: string[];
}

export interface CartItem {
  name: string;
  quantity?: string;
  source: string; // recipe name(s) | 'household' | 'extra'
}

export interface CartProposal {
  id: string;
  delivery_date: string;
  status: 'pending' | 'approved' | 'rejected';
  target_meal_count: number;
  kept_recipes: ProposedRecipe[];
  dropped_recipes: ProposedRecipe[];
  items: CartItem[];
  skipped_items: { name: string; reason: string }[];
  backlog_snapshot: BacklogItem[];
  grocery_item_ids: string[];
  slack_channel: string | null;
  slack_ts: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface LateNote {
  parent: Parent | null;
  title: string;
  until: string;
}

export interface KitchenState {
  date: string;
  dinner: DinnerRow;
  backlog: BacklogItem[];
  chores: Chore[];
  events: LogisticsEvent[];
  conflicts: Conflict[];
  groceries: GroceryItem[];
  lateTonight: LateNote[];
  orders: CartProposal[];
}

export type KioskAction =
  | { type: 'claim_dinner'; chef: 'daniela' | 'warren' | 'takeout'; recipeName?: string | null }
  | { type: 'unclaim_dinner' }
  | { type: 'not_tonight'; parent: Parent; unavailable: boolean }
  | { type: 'cook_from_backlog'; backlogId: string }
  | { type: 'dinner_cooked' }
  | { type: 'backlog_status'; id: string; status: 'cooked' | 'discarded' }
  | { type: 'add_backlog'; name: string; location: BacklogLocation }
  | { type: 'toggle_chore'; id: string; completed: boolean }
  | { type: 'assign_logistics'; id: string; parent: Assignee }
  | { type: 'add_grocery'; name: string }
  | { type: 'grocery_status'; id: string; status: 'got' | 'needed' };
