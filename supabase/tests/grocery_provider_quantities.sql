begin;
do $$
declare
  label text := 'cart-'||gen_random_uuid()::text;
  recovery_label text := 'manual-'||gen_random_uuid()::text;
  request_id uuid;
  snapshot jsonb;
  base jsonb;
  prepared jsonb;
  actual_product jsonb := '{"product_id":"synthetic-weighted","name":"Synthetic produce","quantity":1,"quantity_type":"weight"}';
  receipt jsonb;
  result jsonb;
begin
  if not public.grocery_agent_product_valid(actual_product||'{"quantity":0.5}',true)
    or public.grocery_agent_product_valid(actual_product||'{"quantity":0.5}')
    or public.grocery_agent_product_valid(actual_product||'{"quantity":-0.5}',true)
    or public.grocery_agent_product_valid(actual_product||'{"quantity_type":"invented"}',true)
    then raise exception 'Invalid observed/receipt quantity rules'; end if;
  result := public.grocery_trusted_device_mutate(jsonb_build_object('action','add','added_by','kiosk',
    'operation_id',label||'-add','items','[{"name":"Synthetic produce","quantity":"1"}]'::jsonb));
  request_id := (result->'added_ids'->>0)::uuid;
  snapshot := public.grocery_agent_list_pending(label);
  if snapshot->>'cart_quantity_format' is distinct from '2' then raise exception 'Missing quantity capability'; end if;
  base := jsonb_build_object('run_id',label,'request_id',request_id,'revision',1,'retailer','Wegmans',
    'observed_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  prepared := public.grocery_agent_progress(base || jsonb_build_object('phase','prepare','operation_id',label||'-prepare',
    'quick_add','{"query":"Synthetic produce","quantity":1}'::jsonb,'observed_cart',jsonb_build_array(actual_product||'{"quantity":0.5}')));
  if prepared->>'ok' is distinct from 'true' then raise exception 'Weighted baseline failed: %',prepared; end if;
  result := public.grocery_agent_progress(base || jsonb_build_object('phase','complete','operation_id',label||'-attention',
    'outcome','needs_attention','reason','Provider result awaiting verification.',
    'worker_token',prepared->>'worker_token','claim_token',prepared->>'claim_token'));
  if result->>'status' is distinct from 'needs_attention' then raise exception 'Failed to record initial uncertainty'; end if;
  snapshot := public.grocery_agent_list_pending(recovery_label);
  if not exists(select 1 from jsonb_array_elements(snapshot->'requests') r where r->>'id'=request_id::text
    and r->'attempts'->0->>'attempt_id'=prepared->>'attempt_id') then raise exception 'Manual recovery snapshot omitted parked attempt'; end if;
  receipt := base || jsonb_build_object('phase','complete','run_id',recovery_label,'operation_id',label||'-recover',
    'outcome','already_in_cart','recovery_attempt_id',prepared->>'attempt_id','product',actual_product);
  result := public.grocery_agent_progress(receipt);
  if result->>'code' is distinct from 'claim_active' then raise exception 'Recovery accepted while original claim active'; end if;
  update public.grocery_agent_attempts set lease_expires_at=clock_timestamp()-interval '1 second' where id=(prepared->>'attempt_id')::uuid;
  result := public.grocery_agent_progress(receipt);
  if result->>'status' is distinct from 'in_cart' then raise exception 'Failed to record confirmed existing product: %',result; end if;
  select i->'result' into result from jsonb_array_elements(public.grocery_device_list()->'items') i where i->>'id'=request_id::text;
  if result->>'product_quantity_type' is distinct from 'weight' or result->>'product_size' is not null
    or result->>'product_quantity' is distinct from '1' or result->>'requires_reconciliation' is distinct from 'false'
    then raise exception 'Receipt omitted weight units or invented a size'; end if;
  if (select count(*) from public.grocery_agent_attempts a where a.request_id=(base->>'request_id')::uuid and a.intent is not null)<>1 then
    raise exception 'Recovery created a second add intent';
  end if;
end;
$$;
rollback;
