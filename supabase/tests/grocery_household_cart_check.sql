-- Local rollback-only regression for a household's checked-missing action.
begin;
do $$
declare
  label text := 'cart-check-' || gen_random_uuid()::text;
  request_id uuid;
  attempt_id uuid;
  base jsonb;
  prepared jsonb;
  display jsonb;
  retry jsonb;
  res jsonb;
  run_label text;
  initial_status text;
  product jsonb := '{"product_id":"test-turkey","name":"Synthetic turkey","size":"8 oz","quantity":1}';
begin
  if has_function_privilege('anon','public.grocery_trusted_device_mutate(jsonb)','execute')
    or has_function_privilege('authenticated','public.grocery_trusted_device_mutate(jsonb)','execute')
    then raise exception 'Household retry RPC is public'; end if;
  foreach initial_status in array array['needs_attention','needed'] loop
    run_label := label || '-' || initial_status;
    res := public.grocery_trusted_device_mutate(jsonb_build_object('action','add','operation_id',run_label||'-add',
      'added_by','kiosk','items','[{"name":"Synthetic turkey","quantity":"1"}]'::jsonb));
    request_id := (res->'added_ids'->>0)::uuid;
    perform public.grocery_agent_list_pending(run_label);
    base := jsonb_build_object('run_id',run_label,'request_id',request_id,'revision',1,'retailer','Wegmans',
      'observed_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
    prepared := public.grocery_agent_progress(base || jsonb_build_object('phase','prepare','operation_id',run_label||'-prepare',
      'quick_add','{"query":"Synthetic turkey","quantity":1}'::jsonb,'observed_cart','[]'::jsonb));
    if prepared->>'ok' is distinct from 'true' then raise exception 'Setup claim failed'; end if;
    attempt_id := (prepared->>'attempt_id')::uuid;
    if initial_status='needs_attention' then
      res := public.grocery_agent_progress(base || jsonb_build_object('phase','complete','operation_id',run_label||'-attention',
        'outcome','needs_attention','reason','Ambiguous provider acknowledgement.',
        'worker_token',prepared->>'worker_token','claim_token',prepared->>'claim_token'));
      if res->>'status' is distinct from 'needs_attention' then raise exception 'Setup receipt failed'; end if;
    end if;
    select i->'result'->'unresolved_attempt' into display from jsonb_array_elements(public.grocery_device_list()->'items') i
      where i->>'id'=request_id::text;
    if display->>'attempt_id' is distinct from attempt_id::text or display->>'retailer' is distinct from 'Wegmans'
      or display->>'request_name' is distinct from 'Synthetic turkey' or display->>'product_quantity' is distinct from '1'
      or display->>'request_quantity' is distinct from '1' or display->>'lease_expires_at' is null then
      raise exception 'Missing historical request identity on review display';
    end if;
    retry := jsonb_build_object('action','retry_missing','id',request_id,'revision',1,'attempt_id',attempt_id);
    if (public.grocery_device_mutate(retry)->>'ok') is distinct from 'false' then raise exception 'Legacy device could retry'; end if;
    if (public.grocery_trusted_device_mutate(retry || jsonb_build_object('attempt_id',gen_random_uuid()))->>'code')
      is distinct from 'revision_conflict' then raise exception 'Wrong claim accepted'; end if;
    if (public.grocery_trusted_device_mutate(retry)->>'code') is distinct from 'claim_active' then raise exception 'Live claim cleared'; end if;
    update public.grocery_agent_attempts a set lease_expires_at=clock_timestamp()-interval '2 seconds' where a.id=attempt_id;
    update public.grocery_agent_runs r set lease_expires_at=clock_timestamp()-interval '2 seconds' where r.run_id=run_label;
    update public.grocery_agent_cart_leases l set expires_at=clock_timestamp()-interval '2 seconds' where l.run_id=run_label;
    res := public.grocery_trusted_device_mutate(retry);
    if res->>'ok' is distinct from 'true' or not exists (select 1 from public.grocery_items g where g.id=request_id
      and g.status='needed' and g.revision=2 and g.cart_authorized_revision=2) then raise exception 'Checked retry did not requeue'; end if;
    if (public.grocery_trusted_device_mutate(retry)->>'code') is distinct from 'revision_conflict'
      then raise exception 'Repeated household action was accepted'; end if;
    if initial_status='needed' then
      res := public.grocery_agent_progress(base || jsonb_build_object('phase','complete','operation_id',run_label||'-late',
        'outcome','in_cart','product',product,'worker_token',prepared->>'worker_token','claim_token',prepared->>'claim_token'));
      if res->>'evidence_recorded' is distinct from 'true' or not exists(select 1 from public.grocery_agent_attempts a
        where a.id=attempt_id and a.evidence->'product'=product and a.obsolete)
        then raise exception 'Late provider evidence discarded'; end if;
    end if;
    if not exists(select 1 from public.grocery_agent_attempts a where a.id=attempt_id and not a.requires_reconciliation
      and a.household_absent_at is not null and a.household_checked_revision=1 and a.intent->'quick_add'->>'query'='Synthetic turkey')
      then raise exception 'Household check or original intent lost'; end if;
    if initial_status='needs_attention' and not exists(select 1 from public.grocery_agent_attempts a where a.id=attempt_id
      and a.evidence->>'reason'='Ambiguous provider acknowledgement.') then raise exception 'Original reason overwritten'; end if;
    res := public.grocery_agent_list_pending(run_label||'-retry');
    if not exists(select 1 from jsonb_array_elements(res->'requests') r where r->>'id'=request_id::text
      and r->>'revision'='2' and r->'attempts'='[]'::jsonb) then raise exception 'Old reconciliation blocked retry'; end if;
    res := public.grocery_agent_progress(base || jsonb_build_object('phase','prepare','run_id',run_label||'-retry',
      'operation_id',run_label||'-retry-prepare','revision',2,'quick_add','{"query":"Synthetic turkey","quantity":1}'::jsonb,'observed_cart','[]'::jsonb));
    if res->>'ok' is distinct from 'true' then raise exception 'Retry could not claim a new addition'; end if;
    -- Settle the synthetic second claim to keep other fixture requests independent.
    perform public.grocery_agent_progress(base || jsonb_build_object('phase','complete','run_id',run_label||'-retry',
      'operation_id',run_label||'-retry-complete','revision',2,'outcome','in_cart','product',product,
      'worker_token',res->>'worker_token','claim_token',res->>'claim_token'));
  end loop;
end;
$$;
rollback;
