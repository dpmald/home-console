-- Rollback-only fixtures. Both retailers and every product below are simulated.
begin;
do $$
declare
  label text := 'cart-' || gen_random_uuid()::text;
  sat text := 'sat-' || gen_random_uuid()::text;
  id_a uuid;
  id_b uuid;
  snapshot jsonb;
  common jsonb;
  preparation jsonb;
  receipt jsonb;
  res jsonb;
  product jsonb := '{"product_id":"provider-test-123","name":"Synthetic turkey","size":"16 oz","quantity":1}';
begin
  insert into public.grocery_items(name,quantity,added_by) values ('Synthetic turkey','1','fixture') returning id into id_a;
  snapshot := public.grocery_agent_list_pending(label);
  if exists(select 1 from jsonb_array_elements(snapshot->'requests') r where r->>'id'=id_a::text) then
    raise exception 'Unconfirmed legacy input reached the worker';
  end if;
  if jsonb_array_length(snapshot->'requests')=0 and exists(select 1 from public.grocery_agent_runs where run_id=label) then
    raise exception 'Empty poll created a durable run';
  end if;
  perform public.grocery_trusted_device_mutate(jsonb_build_object('action','authorize','id',id_a,'revision',1));
  label := label || '-ready';
  snapshot := public.grocery_agent_list_pending(label);
  if snapshot->>'queue_policy' is distinct from 'authorized-revision-v1' or not exists(
    select 1 from jsonb_array_elements(snapshot->'requests') r where r->>'id'=id_a::text and r->>'revision'='1'
  ) then raise exception 'Trusted request was missing'; end if;
  snapshot := public.grocery_agent_list_pending(sat);
  if exists(select 1 from jsonb_array_elements(snapshot->'requests') r where r->>'id'=id_a::text) then
    raise exception 'Saturday saw a new explicit request';
  end if;
  common := jsonb_build_object('run_id',label,'request_id',id_a,'revision',1,'retailer','Wegmans',
    'observed_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  preparation := common || jsonb_build_object('phase','prepare','operation_id',label||'-prep',
    'quick_add',jsonb_build_object('query','Synthetic turkey','quantity',1),'observed_cart','[]'::jsonb);
  -- Simulate a snapshot acquired by Saturday before migration.
  update public.grocery_agent_runs set snapshot=(select r.snapshot from public.grocery_agent_runs r where r.run_id=label)
    where run_id=sat;
  res := public.grocery_agent_progress(preparation || jsonb_build_object('run_id',sat,'operation_id',sat||'-prep'));
  if res->>'code' is distinct from 'untrusted_request' then raise exception 'Saturday could claim explicit request: %',res; end if;
  res := public.grocery_agent_progress(preparation || jsonb_build_object('product',product));
  if res->>'code' is distinct from 'invalid_input' then raise exception 'Both intents accepted'; end if;
  res := public.grocery_agent_progress(preparation || '{"quick_add":{"query":"test","quantity":0}}');
  if res->>'code' is distinct from 'invalid_input' then raise exception 'Invalid package count accepted'; end if;
  res := public.grocery_agent_progress(preparation);
  if res->>'ok' is distinct from 'true' or res->>'queue_policy' is distinct from 'authorized-revision-v1' then
    raise exception 'Quick-add claim failed: %',res;
  end if;
  if not exists(select 1 from public.grocery_agent_attempts a where a.id=(res->>'attempt_id')::uuid
    and a.intent->'quick_add'=preparation->'quick_add' and not (a.intent ? 'product') and a.requires_reconciliation)
    then raise exception 'Missing search intent or fabricated product'; end if;
  receipt := common || jsonb_build_object('phase','complete','operation_id',label||'-complete','outcome','in_cart',
    'worker_token',res->>'worker_token','claim_token',res->>'claim_token');
  if (public.grocery_agent_progress(preparation)->>'replayed') is distinct from 'true' then raise exception 'Prepare replay failed'; end if;
  if (public.grocery_agent_progress(receipt)->>'code') is distinct from 'invalid_input' then raise exception 'Missing evidence accepted'; end if;
  res := public.grocery_agent_progress(receipt || jsonb_build_object('product',product));
  if res->>'status' is distinct from 'in_cart' or not exists (
    select 1 from public.grocery_agent_attempts a where a.id=(res->>'attempt_id')::uuid and a.evidence->'product'=product)
    then raise exception 'Missing confirmed actual cart evidence: %',res; end if;
  if exists(select 1 from public.grocery_agent_cart_leases where run_id=label and expires_at>clock_timestamp()) then
    -- Other synthetic rows can exist in the caller's fixture database. Only a finished snapshot should close.
    if jsonb_array_length((select r.snapshot from public.grocery_agent_runs r where r.run_id=label))=1 then
      raise exception 'Single settled request retained the active lease';
    end if;
  end if;
  res := public.grocery_trusted_device_mutate(jsonb_build_object('action','add','operation_id',label||'-add',
    'added_by','kiosk','items','[{"name":"Second synthetic request","quantity":"2"}]'::jsonb));
  id_b := (res->'added_ids'->>0)::uuid;
  snapshot := public.grocery_agent_list_pending(label || '-next');
  if id_b is null or not exists(select 1 from jsonb_array_elements(snapshot->'requests') r where r->>'id'=id_b::text)
    then raise exception 'Next confirmed item was missing'; end if;
  res := public.grocery_agent_progress(common || jsonb_build_object('request_id',id_b,'run_id',label||'-next',
    'phase','complete','operation_id',label||'-reuse','outcome','already_in_cart','product',product));
  if res->>'code' is distinct from 'claim_required' then raise exception 'Earlier cart line double-counted: %',res; end if;
  perform public.grocery_trusted_device_mutate(jsonb_build_object('action','edit','id',id_b,'revision',1,
    'name','Edited synthetic item','quantity','3','notes',null));
  res := public.grocery_agent_progress(preparation || jsonb_build_object('run_id',label||'-next','request_id',id_b,'operation_id',label||'-stale'));
  if res->>'code' is distinct from 'revision_conflict' then raise exception 'Edited quantity accepted: %',res; end if;
  perform set_config('home_console.grocery_cart_actor','device',true);
  insert into public.grocery_items(name,quantity,added_by)
    select 'Synthetic backlog item '||n,'1','fixture' from generate_series(1,101) n;
  snapshot := public.grocery_agent_list_pending(label||'-backlog');
  if jsonb_array_length(snapshot->'requests') is distinct from 20 then raise exception 'Backlog prevented a bounded batch'; end if;
end;
$$;
rollback;
