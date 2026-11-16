-- Forward upgrade for databases created before main's November 15 changes.
-- Main incorporated these changes into 0001, which existing databases already
-- applied. Keep 0002 intact and preserve existing chores and completions.
alter table public.wesley_chore_templates
  add column if not exists category text not null default 'allowance'
    check (category in ('allowance', 'pay_per_chore')),
  add column if not exists reward_cents int not null default 0;

alter table public.wesley_chores
  add column if not exists category text not null default 'allowance'
    check (category in ('allowance', 'pay_per_chore')),
  add column if not exists reward_cents int not null default 0;

create index if not exists dinner_schedule_linked_backlog_idx
  on public.dinner_schedule (linked_backlog_id);

-- Preserve main's one-notification-per-table-per-transaction behavior and
-- 0002's restricted search path. The kiosk consumes these as invalidations.
create or replace function public.broadcast_kitchen_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  flag_key text := 'kitchen.notified_' || TG_TABLE_NAME;
begin
  if TG_OP = 'UPDATE' and NEW is not distinct from OLD then
    return null;
  end if;

  if coalesce(current_setting(flag_key, true), '') = txid_current()::text then
    return null;
  end if;
  perform set_config(flag_key, txid_current()::text, true);

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

create or replace trigger kitchen_broadcast after insert or update or delete on public.fridge_backlog for each row execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.dinner_schedule for each row execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.wesley_chores for each row execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.family_logistics for each row execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.grocery_items for each row execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.cart_proposals for each row execute function public.broadcast_kitchen_change();
