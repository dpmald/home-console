-- Run only in the dedicated synthetic database, after migrations 0004 and 0005.
-- No external carts; preserve existing records and roll back every fixture.
begin;
insert into public.grocery_cart_actor_scope(backend_pid,transaction_id,actor)
  values(pg_backend_pid(),pg_current_xact_id(),'device');
do $$
declare
  prefix text := 'lease-test-' || gen_random_uuid()::text;
  holder text;
  contender text;
  first_id uuid;
  next_id uuid;
  prepared jsonb;
  result jsonb;
  snapshot jsonb;
  operation jsonb;
  product jsonb := '{"product_id":"synthetic-lease-test","name":"Synthetic lease test product","size":"1 package","quantity":1}'::jsonb;
begin
  perform pg_advisory_xact_lock(73482910293847);
  if exists(select 1 from public.grocery_agent_cart_leases where retailer='Wegmans' and expires_at>clock_timestamp()) then
    raise exception 'Wait for the existing Wegmans development lease before this regression';
  end if;
  holder:=prefix||'-holder'; contender:=prefix||'-next';
  insert into public.grocery_items(name,added_by) values('Synthetic lease first','Lease regression') returning id into first_id;
  insert into public.grocery_items(name,added_by) values('Synthetic lease next','Lease regression') returning id into next_id;
  perform public.grocery_agent_list_pending(holder);
  perform public.grocery_agent_list_pending(contender);
  operation:=jsonb_build_object('phase','prepare','operation_id',prefix||'-first','run_id',holder,
    'request_id',first_id,'revision',1,'retailer','Wegmans','product',product,
    'observed_cart','[]'::jsonb,'observed_at',clock_timestamp());
  prepared:=public.grocery_agent_progress(operation);
  if prepared->>'ok' is distinct from 'true' then raise exception 'Holder prepare failed'; end if;
  result:=public.grocery_agent_progress(jsonb_build_object('phase','complete','operation_id',prefix||'-done',
    'run_id',holder,'request_id',first_id,'revision',1,'retailer','Wegmans','product',product,
    'outcome','in_cart','observed_at',clock_timestamp(),'worker_token',prepared->>'worker_token',
    'claim_token',prepared->>'claim_token'));
  if result->>'ok' is distinct from 'true' then raise exception 'Holder completion failed'; end if;

  -- Completion must not let a second run overlap the holder's remaining work.
  operation:=operation||jsonb_build_object('operation_id',prefix||'-blocked','run_id',contender,'request_id',next_id);
  result:=public.grocery_agent_progress(operation);
  if result->>'code' is distinct from 'cart_busy'
    or result->>'retailer' is distinct from 'Wegmans'
    or result->>'blocking_run_id' is distinct from holder
    or result->'lease_expires_at' is distinct from prepared->'lease_expires_at'
    or result->>'retryable' is distinct from 'true'
    or coalesce((result->>'retry_after_seconds')::integer,0) not between 1 and 900
    or result ? 'worker_token' or result ? 'claim_token' then
    raise exception 'Busy response lacks safe actionable lease diagnostics';
  end if;
  result:=public.grocery_agent_progress(operation);
  if result->>'code' is distinct from 'cart_busy' or result->'lease_expires_at' is distinct from prepared->'lease_expires_at' then
    raise exception 'Immediate retry lost the live lease conflict';
  end if;
  if exists(select 1 from public.grocery_agent_attempts where run_id=contender)
    or exists(select 1 from public.grocery_agent_operations where operation_id=prefix||'-blocked') then
    raise exception 'Busy failure created an attempt or cached a transient error';
  end if;
  snapshot:=public.grocery_agent_list_pending(contender);
  if snapshot->>'retailer' is not null or snapshot->>'lease_expires_at' is not null then
    raise exception 'Unclaimed contender acquired run ownership';
  end if;

  -- Expire only this test's lease, never another run's lease. Fresh observation
  -- is required after waiting; an old cart read cannot authorize a new addition.
  update public.grocery_agent_runs set lease_expires_at=clock_timestamp()-interval '1 second' where run_id=holder;
  update public.grocery_agent_cart_leases set expires_at=clock_timestamp()-interval '1 second' where run_id=holder;
  update public.grocery_agent_attempts set lease_expires_at=clock_timestamp()-interval '1 second' where run_id=holder;
  result:=public.grocery_agent_progress(operation||jsonb_build_object('operation_id',prefix||'-stale',
    'observed_at',clock_timestamp()-interval '6 minutes'));
  if result->>'code' is distinct from 'stale_observation' then raise exception 'Stale cart read accepted'; end if;
  result:=public.grocery_agent_progress(operation||jsonb_build_object('operation_id',prefix||'-fresh','observed_at',clock_timestamp()));
  if result->>'ok' is distinct from 'true' or result->>'worker_token' is null or result->>'claim_token' is null then
    raise exception 'Expired holder still blocked a fresh preparation';
  end if;
  if not exists(select 1 from public.grocery_agent_cart_leases where retailer='Wegmans' and run_id=contender) then
    raise exception 'New run did not acquire the expired lease';
  end if;
  raise notice 'grocery_agent_lease: completed holder, conflict timing, no token leak, no failed write, expiry and fresh observation passed';
end;
$$;
rollback;
