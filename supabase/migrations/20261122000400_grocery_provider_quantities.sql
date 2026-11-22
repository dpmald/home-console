-- The provider can omit package size and return fractional existing cart units.
-- A confirmed requested increment and a selected product still require whole units.
create or replace function public.grocery_agent_product_valid(p_product jsonb, p_allow_zero boolean default false)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare
  amount numeric;
begin
  if jsonb_typeof(p_product) is distinct from 'object'
    or jsonb_typeof(p_product->'quantity') is distinct from 'number' then return false; end if;
  amount := (p_product->>'quantity')::numeric;
  return coalesce(jsonb_typeof(p_product->'product_id')='string' and length(btrim(p_product->>'product_id')) between 1 and 160
    and jsonb_typeof(p_product->'name')='string' and length(btrim(p_product->>'name')) between 1 and 250
    and (not (p_product ? 'size') or (jsonb_typeof(p_product->'size')='string' and length(p_product->>'size')<=100))
    and (not (p_product ? 'quantity_type') or p_product->>'quantity_type'='weight')
    and amount between 0 and 100 and (p_allow_zero or (amount>=1 and amount=trunc(amount)))
    and not exists(select 1 from jsonb_object_keys(p_product) k
      where k not in ('product_id','name','size','quantity','quantity_type')), false);
end;
$$;

-- The MCP transport advertises weighted_observations only after it recognizes
-- this database version. Clients can safely use legacy inputs during rollout.
alter function public.grocery_agent_list_pending(text) rename to grocery_agent_list_pending_snapshot;
revoke all on function public.grocery_agent_list_pending_snapshot(text) from public, anon, authenticated, service_role;
create function public.grocery_agent_list_pending(p_run_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  result jsonb := public.grocery_agent_list_pending_snapshot(p_run_id);
begin
  if result->>'ok'='true' then return result || jsonb_build_object('cart_quantity_format',2); end if;
  return result;
end;
$$;
revoke all on function public.grocery_agent_list_pending(text) from public, anon, authenticated;
grant execute on function public.grocery_agent_list_pending(text) to service_role;

create or replace function public.grocery_device_list()
returns jsonb language sql security definer set search_path = pg_catalog as $$
  select jsonb_build_object('ok',true,'items',coalesce(jsonb_agg(
    to_jsonb(g) || jsonb_build_object('result', case when a.id is not null or unresolved.id is not null then jsonb_build_object(
      'outcome',a.outcome,'retailer',a.retailer,
      'product_name',a.evidence->'product'->>'name','product_size',a.evidence->'product'->>'size',
      'product_quantity',a.evidence->'product'->'quantity','product_quantity_type',a.evidence->'product'->>'quantity_type',
      'reason',a.evidence->>'reason',
      'requires_reconciliation',unresolved.id is not null,
      'unresolved_attempt',case when unresolved.claim_count=1 and unresolved.intent is not null then
        jsonb_build_object('attempt_id',unresolved.id,'retailer',unresolved.retailer,'revision',unresolved.revision,
          'lease_expires_at',unresolved.lease_expires_at,'request_name',submitted.item->>'name',
          'request_quantity',submitted.item->>'quantity',
          'product_name',coalesce(unresolved.intent->'product'->>'name',unresolved.intent->'quick_add'->>'query'),
          'product_size',unresolved.intent->'product'->>'size','product_quantity_type',unresolved.intent->'product'->>'quantity_type',
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
    order by created_at desc,completed_at desc nulls last,id limit 1) a on true
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
