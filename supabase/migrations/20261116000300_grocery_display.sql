-- Device requests share the connector's transactional lock and revision protocol.
-- Only the service role may call these operations. No external cart is changed.
create table public.grocery_device_operations (
  operation_id text primary key,
  payload jsonb not null,
  request_ids uuid[] not null,
  created_at timestamptz not null default now()
);
alter table public.grocery_device_operations enable row level security;
revoke all on public.grocery_device_operations from public, anon, authenticated;
grant select, insert on public.grocery_device_operations to service_role;

create function public.grocery_device_list()
returns jsonb language sql security definer set search_path = pg_catalog as $$
  select jsonb_build_object('ok',true,'items',coalesce(jsonb_agg(
    to_jsonb(g) || jsonb_build_object('result', case when a.id is not null or exists (
      select 1 from public.grocery_agent_attempts u where u.request_id=g.id and u.requires_reconciliation
    ) then jsonb_build_object(
      'outcome',a.outcome,'retailer',a.retailer,
      'product_name',a.evidence->'product'->>'name', 'reason',a.evidence->>'reason',
      'requires_reconciliation',exists(select 1 from public.grocery_agent_attempts u
        where u.request_id=g.id and u.requires_reconciliation)
    ) else null end)
    order by g.created_at desc,g.id),'[]'::jsonb))
  from (select id,name,quantity,notes,status,revision,added_by,created_at,updated_at
    from public.grocery_items order by
      case when status in ('needed','needs_attention','in_cart') then 0 else 1 end,
      created_at desc,id limit 200) g
  left join lateral (select id,outcome,retailer,evidence from public.grocery_agent_attempts
    where request_id=g.id and revision=g.revision and not obsolete
    order by created_at desc,id limit 1) a on true;
$$;
revoke all on function public.grocery_device_list() from public, anon, authenticated;
grant execute on function public.grocery_device_list() to service_role;

create function public.grocery_device_mutate(p_action jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_kind text := p_action->>'action';
  v_op text := p_action->>'operation_id';
  v_cached public.grocery_device_operations%rowtype;
  v_item jsonb;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_request public.grocery_items%rowtype;
begin
  if jsonb_typeof(p_action) is distinct from 'object' or length(p_action::text)>24000
    or coalesce(v_kind,'') not in ('add','edit','status') then
    return public.grocery_agent_error('invalid_input','Invalid grocery request.');
  end if;
  perform pg_advisory_xact_lock(73482910293847);
  if v_kind='add' then
    if coalesce(v_op,'') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
      or jsonb_typeof(p_action->'items') is distinct from 'array'
      or coalesce(p_action->>'added_by','') not in ('kiosk','voice') then
      return public.grocery_agent_error('invalid_input','Invalid request batch.');
    end if;
    if jsonb_array_length(p_action->'items') not between 1 and 20 then
      return public.grocery_agent_error('invalid_input','Add between 1 and 20 items.');
    end if;
    for v_item in select value from jsonb_array_elements(p_action->'items') loop
      if jsonb_typeof(v_item) is distinct from 'object'
        or jsonb_typeof(v_item->'name') is distinct from 'string'
        or length(btrim(v_item->>'name')) not between 1 and 250
        or (v_item->'quantity' is not null and jsonb_typeof(v_item->'quantity') not in ('string','null'))
        or length(coalesce(v_item->>'quantity',''))>100
        or (v_item->'notes' is not null and jsonb_typeof(v_item->'notes') not in ('string','null'))
        or length(coalesce(v_item->>'notes',''))>500 then
        return public.grocery_agent_error('invalid_input','Check item name, quantity and notes.');
      end if;
    end loop;
    select * into v_cached from public.grocery_device_operations where operation_id=v_op;
    if found then
      if v_cached.payload<>p_action then
        return public.grocery_agent_error('idempotency_conflict','This save was already used with different items.');
      end if;
      return public.grocery_device_list() || jsonb_build_object('added_ids',to_jsonb(v_cached.request_ids),'replayed',true);
    end if;
    for v_item in select value from jsonb_array_elements(p_action->'items') loop
      insert into public.grocery_items(name,quantity,notes,added_by)
        values(btrim(v_item->>'name'),nullif(btrim(v_item->>'quantity'),''),nullif(btrim(v_item->>'notes'),''),p_action->>'added_by')
        returning id into v_id;
      v_ids:=array_append(v_ids,v_id);
    end loop;
    insert into public.grocery_device_operations(operation_id,payload,request_ids) values(v_op,p_action,v_ids);
    return public.grocery_device_list() || jsonb_build_object('added_ids',to_jsonb(v_ids));
  end if;

  if coalesce(p_action->>'id','') !~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
    or coalesce(p_action->>'revision','') !~ '^[1-9][0-9]{0,8}$' then
    return public.grocery_agent_error('invalid_input','Invalid request identity.');
  end if;
  select * into v_request from public.grocery_items where id=(p_action->>'id')::uuid for update;
  if not found then return public.grocery_agent_error('request_missing','This request no longer exists.'); end if;
  if v_request.revision<>(p_action->>'revision')::integer then
    return public.grocery_agent_error('revision_conflict','This request changed. Refresh before editing it.');
  end if;
  if v_kind='edit' then
    if jsonb_typeof(p_action->'name') is distinct from 'string'
      or length(btrim(p_action->>'name')) not between 1 and 250
      or (p_action->'quantity' is not null and jsonb_typeof(p_action->'quantity') not in ('string','null'))
      or length(coalesce(p_action->>'quantity',''))>100
      or (p_action->'notes' is not null and jsonb_typeof(p_action->'notes') not in ('string','null'))
      or length(coalesce(p_action->>'notes',''))>500 then
      return public.grocery_agent_error('invalid_input','Check item name, quantity and notes.');
    end if;
    update public.grocery_items set name=btrim(p_action->>'name'),
      quantity=nullif(btrim(p_action->>'quantity'),''),notes=nullif(btrim(p_action->>'notes'),'') where id=v_request.id;
  else
    if coalesce(p_action->>'status','') not in ('needed','got','cancelled') then
      return public.grocery_agent_error('invalid_input','Unsupported request status.');
    end if;
    update public.grocery_items set status=p_action->>'status' where id=v_request.id;
  end if;
  return public.grocery_device_list();
end;
$$;
revoke all on function public.grocery_device_mutate(jsonb) from public, anon, authenticated;
grant execute on function public.grocery_device_mutate(jsonb) to service_role;
