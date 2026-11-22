-- Only an explicitly submitted household revision may drive a shared cart.
-- Existing rows, old device RPCs and ordinary kitchen imports start unconfirmed.
alter table public.grocery_items add column cart_authorized_revision integer
  check (cart_authorized_revision is null or cart_authorized_revision = revision);

-- Scoped markers are visible only to the migration owner. Wrapper calls restore
-- the previous actor before returning. A raised error rolls back their writes.
create table public.grocery_cart_actor_scope (
  backend_pid integer not null,
  transaction_id xid8 not null,
  actor text not null check (actor in ('device','agent')),
  primary key (backend_pid,transaction_id)
);
alter table public.grocery_cart_actor_scope enable row level security;
revoke all on public.grocery_cart_actor_scope from public, anon, authenticated, service_role;

create function public.grocery_cart_set_actor(p_actor text)
returns text language plpgsql set search_path=pg_catalog as $$
declare
  previous_actor text;
  backend integer := pg_backend_pid();
  tx xid8 := pg_current_xact_id();
begin
  select s.actor into previous_actor from public.grocery_cart_actor_scope s
    where s.backend_pid=backend and s.transaction_id=tx;
  if p_actor is null then
    delete from public.grocery_cart_actor_scope s where s.backend_pid=backend and s.transaction_id=tx;
  else
    insert into public.grocery_cart_actor_scope(backend_pid,transaction_id,actor) values(backend,tx,p_actor)
      on conflict(backend_pid,transaction_id) do update set actor=excluded.actor;
  end if;
  return previous_actor;
end;
$$;
revoke all on function public.grocery_cart_set_actor(text) from public, anon, authenticated, service_role;

create function public.grocery_protect_cart_request()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor text;
begin
  select s.actor into actor from public.grocery_cart_actor_scope s
    where s.backend_pid=pg_backend_pid() and s.transaction_id=pg_current_xact_id_if_assigned();
  if actor = 'device' then
    new.cart_authorized_revision := new.revision;
  elsif tg_op = 'INSERT' then
    new.cart_authorized_revision := null;
  elsif old.cart_authorized_revision is not null and new is distinct from old then
    if actor is distinct from 'agent' or new.status not in ('in_cart','needs_attention')
       or (to_jsonb(new) - 'status' - 'updated_at') <> (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'Use the household grocery list to change a confirmed request.' using errcode = '42501';
    end if;
  else
    new.cart_authorized_revision := old.cart_authorized_revision;
  end if;
  return new;
end;
$$;
-- PostgreSQL runs same-kind triggers by name. Stamp the final revision after
-- grocery_request_revision has applied its content/status transition rules.
create trigger grocery_trusted_revision before insert or update on public.grocery_items
  for each row execute function public.grocery_protect_cart_request();
revoke all on function public.grocery_protect_cart_request() from public, anon, authenticated;

-- Keep the effective caller's identity for owner-only maintenance deletes.
create function public.grocery_protect_cart_delete()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if old.cart_authorized_revision is not null and current_user <>
        (select tableowner from pg_catalog.pg_tables where schemaname='public' and tablename='grocery_items') then
    raise exception 'Cancel a confirmed request on the household grocery list.' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function public.grocery_protect_cart_delete() from public, anon, authenticated;
create trigger grocery_trusted_delete before delete on public.grocery_items
  for each row execute function public.grocery_protect_cart_delete();

create function public.grocery_trusted_device_mutate_impl(p_action jsonb)
returns jsonb language plpgsql set search_path = pg_catalog as $$
declare
  item public.grocery_items%rowtype;
  result jsonb;
begin
  -- Function-local actor is restored on return, including inside caller transactions.
  if p_action->>'action' is distinct from 'authorize' then
    result := public.grocery_device_mutate(p_action);
    if result->>'replayed' = 'true' and exists (
      select 1 from jsonb_array_elements_text(result->'added_ids') ids(id)
      left join public.grocery_items g on g.id = ids.id::uuid
      where g.cart_authorized_revision is null
    ) then
      return public.grocery_agent_error('idempotency_conflict','Confirm the existing request on the household list.');
    end if;
    return result;
  end if;
  if coalesce(p_action->>'id','') !~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
     or coalesce(p_action->>'revision','') !~ '^[1-9][0-9]{0,8}$' then
    return public.grocery_agent_error('invalid_input','Invalid request identity.');
  end if;
  perform pg_advisory_xact_lock(73482910293847);
  select * into item from public.grocery_items where id=(p_action->>'id')::uuid for update;
  if not found then return public.grocery_agent_error('request_missing','This request no longer exists.'); end if;
  if item.revision<>(p_action->>'revision')::integer or item.status <> 'needed' then
    return public.grocery_agent_error('revision_conflict','Refresh and review the current request before confirming it.');
  end if;
  update public.grocery_items set cart_authorized_revision=revision where id=item.id;
  return public.grocery_device_list();
end;
$$;
revoke all on function public.grocery_trusted_device_mutate_impl(jsonb) from public, anon, authenticated, service_role;

create function public.grocery_trusted_device_mutate(p_action jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  previous_actor text;
  result jsonb;
begin
  previous_actor := public.grocery_cart_set_actor('device');
  result := public.grocery_trusted_device_mutate_impl(p_action);
  perform public.grocery_cart_set_actor(previous_actor);
  return result;
end;
$$;
revoke all on function public.grocery_trusted_device_mutate(jsonb) from public, anon, authenticated;
grant execute on function public.grocery_trusted_device_mutate(jsonb) to service_role;
create or replace function public.grocery_device_list()
returns jsonb language sql security definer set search_path = pg_catalog as $$
  select jsonb_build_object('ok',true,'items',coalesce(jsonb_agg(
    to_jsonb(g) || jsonb_build_object('result', case when a.id is not null or exists (
      select 1 from public.grocery_agent_attempts u where u.request_id=g.id and u.requires_reconciliation
    ) then jsonb_build_object(
      'outcome',a.outcome,'retailer',a.retailer,
      'product_name',a.evidence->'product'->>'name','product_size',a.evidence->'product'->>'size',
      'product_quantity',a.evidence->'product'->'quantity','reason',a.evidence->>'reason',
      'requires_reconciliation',exists(select 1 from public.grocery_agent_attempts u
        where u.request_id=g.id and u.requires_reconciliation)
    ) else null end)
    order by g.created_at desc,g.id),'[]'::jsonb))
  from (select id,name,quantity,notes,status,revision,cart_authorized_revision,added_by,created_at,updated_at
    from public.grocery_items order by
      case when status in ('needed','needs_attention','in_cart') then 0 else 1 end,
      created_at desc,id limit 200) g
  left join lateral (select id,outcome,retailer,evidence from public.grocery_agent_attempts
    where request_id=g.id and revision=g.revision and not obsolete
    order by created_at desc,id limit 1) a on true;
$$;
