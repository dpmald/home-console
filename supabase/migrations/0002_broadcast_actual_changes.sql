-- Kitchen reads initialize dinner and chores with ON CONFLICT DO NOTHING.
-- Statement triggers broadcast even when those statements change no rows,
-- causing subscribed kiosks to refetch and broadcast again indefinitely.
-- Row triggers skip empty statements; unchanged UPDATE rows also stay silent.
create or replace function public.broadcast_kitchen_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if TG_OP = 'UPDATE' then
    if OLD is not distinct from NEW then
      return null;
    end if;
  end if;

  perform realtime.send(
    jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP),
    'db_change',
    'kitchen',
    false
  );
  return null;
end;
$$;

-- Match the execute restriction added to main after the original schema.
revoke execute on function public.broadcast_kitchen_change() from public, anon, authenticated;

create or replace trigger kitchen_broadcast after insert or update or delete on public.fridge_backlog for each row execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.dinner_schedule for each row execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.wesley_chores for each row execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.family_logistics for each row execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.grocery_items for each row execute function public.broadcast_kitchen_change();
create or replace trigger kitchen_broadcast after insert or update or delete on public.cart_proposals for each row execute function public.broadcast_kitchen_change();
