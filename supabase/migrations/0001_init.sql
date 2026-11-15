-- ════════════════════════════════════════════════════════════════════
-- Home Console — initial schema
-- Run in Supabase SQL editor (or `supabase db push`).
-- RLS is ON for every table with NO anon policies: only the server
-- (service-role key) reads/writes. The kiosk gets realtime "something
-- changed" pings via a broadcast channel and refetches through the API.
-- ════════════════════════════════════════════════════════════════════

-- ── fridge_backlog: Warren's Saturday deliveries, leftovers, pantry ──
create table if not exists public.fridge_backlog (
  id                  uuid primary key default gen_random_uuid(),
  recipe_or_item_name text not null,
  key_perishables     text[] not null default '{}',
  location            text not null default 'fridge'
                        check (location in ('fridge', 'pantry', 'freezer')),
  delivery_date       date not null default current_date,
  status              text not null default 'in_fridge'
                        check (status in ('in_fridge', 'cooked', 'discarded')),
  added_by            text,
  source_proposal_id  uuid,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);
create index if not exists fridge_backlog_status_idx on public.fridge_backlog (status, delivery_date);

-- ── dinner_schedule ──────────────────────────────────────────────────
create table if not exists public.dinner_schedule (
  date              date primary key,
  chef              text not null default 'unclaimed'
                      check (chef in ('daniela', 'warren', 'takeout', 'unclaimed')),
  recipe_name       text,
  linked_backlog_id uuid references public.fridge_backlog (id) on delete set null,
  status            text not null default 'unclaimed'
                      check (status in ('unclaimed', 'planned', 'cooked')),
  -- parents who said "not tonight" (answers "who even wants to cook?")
  unavailable       text[] not null default '{}',
  claimed_via       text,
  updated_at        timestamptz not null default now()
);
create index if not exists dinner_schedule_linked_backlog_idx on public.dinner_schedule (linked_backlog_id);

-- ── Wesley's chores ──────────────────────────────────────────────────
create table if not exists public.wesley_chore_templates (
  id           uuid primary key default gen_random_uuid(),
  chore_title  text not null unique,
  emoji        text,
  days_of_week smallint[] not null default '{0,1,2,3,4,5,6}', -- 0 = Sunday
  sort_order   int not null default 0,
  active       boolean not null default true
);

create table if not exists public.wesley_chores (
  id                     uuid primary key default gen_random_uuid(),
  chore_title            text not null,
  emoji                  text,
  chore_date             date not null,
  sort_order             int not null default 0,
  completed              boolean not null default false,
  completed_at           timestamptz,
  verified_in_greenlight boolean not null default false,
  unique (chore_date, chore_title)
);

-- ── family_logistics (synced by n8n from Outlook + Google) ───────────
create table if not exists public.family_logistics (
  id                uuid primary key default gen_random_uuid(),
  external_event_id text not null unique,
  source_calendar   text not null
                      check (source_calendar in ('warren_outlook', 'daniela_google', 'manual')),
  title             text not null,
  start_time        timestamptz not null,
  end_time          timestamptz not null,
  logistics_type    text not null default 'general'
                      check (logistics_type in ('pickup', 'appointment', 'late_office', 'general')),
  assigned_parent   text not null default 'unassigned'
                      check (assigned_parent in ('daniela', 'warren', 'unassigned')),
  updated_at        timestamptz not null default now()
);
create index if not exists family_logistics_time_idx on public.family_logistics (start_time, end_time);

-- ── grocery_items ("add paper towels to the cart") ───────────────────
create table if not exists public.grocery_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  quantity   text,
  status     text not null default 'needed' check (status in ('needed', 'ordered', 'got')),
  added_by   text,
  created_at timestamptz not null default now()
);

-- ── cart_proposals (Warren's agent → human approval gate) ────────────
create table if not exists public.cart_proposals (
  id                uuid primary key default gen_random_uuid(),
  delivery_date     date not null,
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  target_meal_count int not null,
  kept_recipes      jsonb not null default '[]',
  dropped_recipes   jsonb not null default '[]',
  items             jsonb not null default '[]',
  skipped_items     jsonb not null default '[]',
  backlog_snapshot  jsonb not null default '[]',
  grocery_item_ids  uuid[] not null default '{}',
  slack_channel     text,
  slack_ts          text,
  decided_by        text,
  decided_at        timestamptz,
  created_at        timestamptz not null default now()
);

-- ── bot_runs: cron idempotency + where we posted each Slack message ──
create table if not exists public.bot_runs (
  job           text not null,
  run_key       text not null,
  slack_channel text,
  slack_ts      text,
  created_at    timestamptz not null default now(),
  primary key (job, run_key)
);

-- ── RLS: lock everything down (service role bypasses RLS) ────────────
alter table public.fridge_backlog          enable row level security;
alter table public.dinner_schedule         enable row level security;
alter table public.wesley_chore_templates  enable row level security;
alter table public.wesley_chores           enable row level security;
alter table public.family_logistics        enable row level security;
alter table public.grocery_items           enable row level security;
alter table public.cart_proposals          enable row level security;
alter table public.bot_runs                enable row level security;

-- ── Realtime: broadcast a tiny "table X changed" ping to topic 'kitchen'
-- Works for edits from Slack, the kiosk, voice, n8n AND the Supabase
-- table editor. Payload contains no family data.
create or replace function public.broadcast_kitchen_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(
    jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP),
    'db_change',
    'kitchen',
    false
  );
  return null;
end;
$$;
revoke execute on function public.broadcast_kitchen_change() from public, anon, authenticated;

create or replace trigger kitchen_broadcast after insert or update or delete on public.fridge_backlog for each statement execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.dinner_schedule for each statement execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.wesley_chores for each statement execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.family_logistics for each statement execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.grocery_items for each statement execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.cart_proposals for each statement execute function public.broadcast_kitchen_change();
