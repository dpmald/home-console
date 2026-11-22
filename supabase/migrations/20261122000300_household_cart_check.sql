-- A household member can verify that an uncertain addition is absent at the
-- original retailer. Preserve previous intent, result and any later evidence.
alter table public.grocery_agent_attempts
  add column household_absent_at timestamptz,
  add column household_checked_revision integer check (household_checked_revision > 0),
  add constraint grocery_household_check_complete check (
    (household_absent_at is null) = (household_checked_revision is null));

create function public.grocery_keep_household_cart_check()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  -- A delayed completion of the original claim can still store its actual
  -- provider evidence. Its revision is obsolete and it cannot restart recovery.
  if old.household_absent_at is not null then
    new.requires_reconciliation := false;
    new.obsolete := true;
  end if;
  return new;
end;
$$;
revoke all on function public.grocery_keep_household_cart_check() from public, anon, authenticated;
create trigger grocery_keep_household_cart_check before update of requires_reconciliation on public.grocery_agent_attempts
  for each row execute function public.grocery_keep_household_cart_check();

create or replace function public.grocery_trusted_device_mutate(p_action jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog
  set home_console.grocery_cart_actor = 'device' as $$
declare
  item public.grocery_items%rowtype;
  result jsonb;
  claim public.grocery_agent_attempts%rowtype;
  checked_at timestamptz;
begin
  -- Function-local actor is restored on return, including inside caller transactions.
  if p_action->>'action' not in ('authorize','retry_missing') or p_action->>'action' is null then
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
  if p_action->>'action' = 'retry_missing' then
    if coalesce(p_action->>'attempt_id','') !~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
      or exists(select 1 from jsonb_object_keys(p_action) k where k not in ('action','id','revision','attempt_id')) then
      return public.grocery_agent_error('invalid_input','Retry requires the exact previously displayed cart attempt.');
    end if;
    if item.revision<>(p_action->>'revision')::integer or item.status not in ('needs_attention','needed')
      or item.cart_authorized_revision is distinct from item.revision then
      return public.grocery_agent_error('revision_conflict','Refresh and check the current request before retrying.');
    end if;
    select * into claim from public.grocery_agent_attempts a
      where a.id=(p_action->>'attempt_id')::uuid and a.request_id=item.id and a.requires_reconciliation
        and a.intent is not null and a.household_absent_at is null for update;
    if not found or exists(select 1 from public.grocery_agent_attempts a where a.request_id=item.id
      and a.requires_reconciliation and a.id<>claim.id) then
      return public.grocery_agent_error('revision_conflict','This cart attempt changed. Refresh before retrying.');
    end if;
    checked_at := clock_timestamp();
    if claim.lease_expires_at is null or claim.lease_expires_at>checked_at then
      return public.grocery_agent_error('claim_active','Wait for the original cart claim to expire, then check its retailer again.');
    end if;
    update public.grocery_agent_attempts set requires_reconciliation=false, household_absent_at=checked_at,
      household_checked_revision=item.revision where id=claim.id;
    -- The existing revision trigger advances when entering needed. Even an
    -- earlier return-to-pending or missing acknowledgement gets a fresh revision.
    if item.status='needed' then
      update public.grocery_items set status='needs_attention' where id=item.id;
    end if;
    update public.grocery_items set status='needed' where id=item.id;
    return public.grocery_device_list();
  end if;
  if item.revision<>(p_action->>'revision')::integer or item.status <> 'needed' then
    return public.grocery_agent_error('revision_conflict','Refresh and review the current request before confirming it.');
  end if;
  update public.grocery_items set cart_authorized_revision=revision where id=item.id;
  return public.grocery_device_list();
end;
$$;
revoke all on function public.grocery_trusted_device_mutate(jsonb) from public, anon, authenticated;
grant execute on function public.grocery_trusted_device_mutate(jsonb) to service_role;
create or replace function public.grocery_device_list()
returns jsonb language sql security definer set search_path = pg_catalog as $$
  select jsonb_build_object('ok',true,'items',coalesce(jsonb_agg(
    to_jsonb(g) || jsonb_build_object('result', case when a.id is not null or unresolved.id is not null then jsonb_build_object(
      'outcome',a.outcome,'retailer',a.retailer,
      'product_name',a.evidence->'product'->>'name','product_size',a.evidence->'product'->>'size',
      'product_quantity',a.evidence->'product'->'quantity','reason',a.evidence->>'reason',
      'requires_reconciliation',unresolved.id is not null,
      'unresolved_attempt',case when unresolved.claim_count=1 and unresolved.intent is not null then
        jsonb_build_object('attempt_id',unresolved.id,'retailer',unresolved.retailer,'revision',unresolved.revision,
          'lease_expires_at',unresolved.lease_expires_at,'request_name',submitted.item->>'name',
          'request_quantity',submitted.item->>'quantity',
          'product_name',coalesce(unresolved.intent->'product'->>'name',unresolved.intent->'quick_add'->>'query'),
          'product_size',unresolved.intent->'product'->>'size',
          'product_quantity',coalesce(unresolved.intent->'product'->'quantity',unresolved.intent->'quick_add'->'quantity'))
        end
    ) else null end)
    order by g.created_at desc,g.id),'[]'::jsonb))
  from (select id,name,quantity,notes,status,revision,cart_authorized_revision,added_by,created_at,updated_at
    from public.grocery_items order by
      case when status in ('needed','needs_attention','in_cart') then 0 else 1 end,
      created_at desc,id limit 200) g
  left join lateral (select id,outcome,retailer,evidence from public.grocery_agent_attempts
    where request_id=g.id and revision=g.revision and not obsolete
    order by created_at desc,id limit 1) a on true
  left join lateral (
    select u.id,u.run_id,u.revision,u.retailer,u.lease_expires_at,u.intent,count(*) over () as claim_count
      from public.grocery_agent_attempts u where u.request_id=g.id and u.requires_reconciliation
      order by u.created_at desc,u.id limit 1
  ) unresolved on true
  left join lateral (
    select s.item from public.grocery_agent_runs r cross join lateral jsonb_array_elements(r.snapshot) s(item)
      where r.run_id=unresolved.run_id and s.item->>'id'=g.id::text
        and s.item->>'revision'=unresolved.revision::text limit 1
  ) submitted on true;
$$;
