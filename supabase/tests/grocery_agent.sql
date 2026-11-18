-- Behavioral RPC regression against a dedicated local PostgreSQL database.
-- Requires 0001 and 0004 (and the bootstrap on plain PostgreSQL). All fixtures
-- are rolled back; no external integration is called.
begin;
do $$
declare
  prefix text := 'test-' || gen_random_uuid()::text;
  run_a text;
  run_b text;
  run_c text;
  run_d text;
  run_e text;
  request_a uuid;
  request_b uuid;
  request_c uuid;
  request_d uuid;
  request_late uuid;
  request_lost_ack uuid;
  snap jsonb;
  snap_again jsonb;
  op jsonb;
  prepared jsonb;
  result jsonb;
  product jsonb := '{"product_id":"synthetic-milk","name":"Synthetic whole milk","size":"1 gal","quantity":1}'::jsonb;
  stamp text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  n integer;
begin
  run_a:=prefix||'-a'; run_b:=prefix||'-b'; run_c:=prefix||'-c'; run_d:=prefix||'-d'; run_e:=prefix||'-e';
  insert into public.grocery_items(name,quantity,added_by) values('Synthetic milk','1 gallon','test') returning id into request_a;
  insert into public.grocery_items(name,quantity,added_by) values('Synthetic oats','1 package','test') returning id into request_b;
  insert into public.grocery_items(name,quantity,added_by) values('Synthetic soap','1 package','test') returning id into request_c;
  insert into public.grocery_items(name,quantity,added_by) values('Synthetic edits','1 package','test') returning id into request_d;

  snap:=public.grocery_agent_list_pending(run_a);
  if snap->>'ok'<>'true' then raise exception 'snapshot failed: %',snap; end if;
  insert into public.grocery_items(name,quantity,added_by) values('Synthetic late request','1 package','test') returning id into request_late;
  snap_again:=public.grocery_agent_list_pending(run_a);
  if snap->'snapshot_at'<>snap_again->'snapshot_at' or snap->'requests'<>snap_again->'requests' then
    raise exception 'same run must retain snapshot';
  end if;
  if exists(select 1 from jsonb_array_elements(snap_again->'requests') s where s->>'id'=request_late::text) then
    raise exception 'late request leaked into immutable snapshot';
  end if;
  perform public.grocery_agent_list_pending(run_b);

  op:=jsonb_build_object('phase','prepare','operation_id',prefix||'-prep-a','run_id',run_a,
    'request_id',request_a,'revision',1,'retailer','Wegmans','product',product,'observed_cart','[]'::jsonb,'observed_at',stamp);
  prepared:=public.grocery_agent_progress(op);
  if prepared->>'ok'<>'true' or prepared->>'worker_token' is null or prepared->>'claim_token' is null then
    raise exception 'prepare did not return tokens: %',prepared;
  end if;
  result:=public.grocery_agent_progress(op);
  if result->>'replayed'<>'true' or result->'attempt_id'<>prepared->'attempt_id' then
    raise exception 'prepare replay created another attempt';
  end if;
  result:=public.grocery_agent_progress(op||jsonb_build_object('retailer','Morton Williams Supermarket'));
  if result->>'code'<>'idempotency_conflict' then raise exception 'changed idempotent payload was accepted'; end if;
  result:=public.grocery_agent_progress(op||jsonb_build_object('operation_id',prefix||'-claim-a-other','run_id',run_b));
  if result->>'code'<>'reconciliation_required' then raise exception 'concurrent request claimed twice: %',result; end if;
  result:=public.grocery_agent_progress(op||jsonb_build_object('operation_id',prefix||'-claim-cart-other','run_id',run_b,'request_id',request_b));
  if result->>'code'<>'cart_busy' then raise exception 'concurrent cart worker not blocked: %',result; end if;
  result:=public.grocery_agent_progress(op||jsonb_build_object('operation_id',prefix||'-wrong-worker','request_id',request_b));
  if result->>'code'<>'worker_conflict' then raise exception 'run_id stole worker lease'; end if;

  op:=jsonb_build_object('phase','complete','operation_id',prefix||'-complete-a','run_id',run_a,
    'request_id',request_a,'revision',1,'retailer','Wegmans','outcome','in_cart',
    'product',product||jsonb_build_object('size','SIMULATED 1 unit'),
    'reason','Synthetic test only; no real cart changed.',
    'observed_at',stamp,'worker_token',prepared->>'worker_token','claim_token',prepared->>'claim_token');
  -- Completion reports product evidence, not the prepare-only observed_cart.
  -- Both empty and populated arrays used to pass MCP validation then fail here.
  result:=public.grocery_agent_progress(op||jsonb_build_object('observed_cart','[]'::jsonb));
  if result->>'code'<>'invalid_input' then raise exception 'empty completion cart accepted'; end if;
  result:=public.grocery_agent_progress(op||jsonb_build_object('observed_cart',jsonb_build_array(product)));
  if result->>'code'<>'invalid_input' then raise exception 'populated completion cart accepted'; end if;
  if (select outcome from public.grocery_agent_attempts where id=(prepared->>'attempt_id')::uuid) is not null
    or exists(select 1 from public.grocery_agent_operations where operation_id=prefix||'-complete-a') then
    raise exception 'rejected completion changed the receipt or reserved its operation id';
  end if;
  result:=public.grocery_agent_progress(op);
  if result->>'ok'<>'true' or result->>'status'<>'in_cart' then raise exception 'cart completion failed: %',result; end if;
  if (select status from public.grocery_items where id=request_a)<>'in_cart' then raise exception 'request not marked in cart'; end if;
  if (select revision from public.grocery_items where id=request_a)<>1 then raise exception 'processing result changed user revision'; end if;
  result:=public.grocery_agent_progress(op);
  if result->>'replayed'<>'true' then raise exception 'complete retry not idempotent'; end if;
  result:=public.grocery_agent_progress(op||jsonb_build_object('operation_id',prefix||'-terminal-conflict','outcome','pending','reason','different result'));
  if result->>'code'<>'terminal_conflict' then raise exception 'terminal receipt overwritten'; end if;

  -- Fully covered requests need no preparation or invented tokens.
  op:=jsonb_build_object('phase','complete','operation_id',prefix||'-covered','run_id',run_a,
    'request_id',request_b,'revision',1,'retailer','Wegmans','outcome','already_in_cart','product',product,'observed_at',stamp);
  result:=public.grocery_agent_progress(op);
  if result->>'ok'<>'true' then raise exception 'direct existing coverage failed: %',result; end if;
  if (select count(*) from public.grocery_agent_attempts where request_id=request_b and intent is not null)<>0 then
    raise exception 'already covered request got a mutation intent';
  end if;
  result:=public.grocery_agent_progress(op||jsonb_build_object('operation_id',prefix||'-retailer-switch','request_id',request_c,'retailer','Morton Williams Supermarket'));
  if result->>'code'<>'retailer_conflict' then raise exception 'store switch accepted'; end if;

  -- Prepare another request with this worker, then edit it while external work runs.
  op:=jsonb_build_object('phase','prepare','operation_id',prefix||'-prep-edited','run_id',run_a,
    'request_id',request_d,'revision',1,'retailer','Wegmans','product',product,'observed_cart','[]'::jsonb,
    'observed_at',stamp,'worker_token',prepared->>'worker_token');
  prepared:=public.grocery_agent_progress(op);
  if prepared->>'ok'<>'true' then raise exception 'second prepare failed: %',prepared; end if;
  update public.grocery_items set quantity='2 packages' where id=request_d;
  if (select revision from public.grocery_items where id=request_d)<>2 then raise exception 'edit did not increment revision'; end if;
  op:=jsonb_build_object('phase','complete','operation_id',prefix||'-complete-edited','run_id',run_a,
    'request_id',request_d,'revision',1,'retailer','Wegmans','outcome','in_cart','product',product,
    'observed_at',stamp,'worker_token',prepared->>'worker_token','claim_token',prepared->>'claim_token');
  result:=public.grocery_agent_progress(op);
  if result->>'code'<>'revision_conflict' or result->>'evidence_recorded'<>'true' then raise exception 'stale result evidence lost: %',result; end if;
  if (select status from public.grocery_items where id=request_d)<>'needed' then raise exception 'stale result fulfilled edited request'; end if;
  if not exists(select 1 from public.grocery_agent_attempts where id=(prepared->>'attempt_id')::uuid and obsolete and evidence is not null and requires_reconciliation) then
    raise exception 'obsolete evidence not retained for recovery';
  end if;

  -- Expiry forbids new work; recovery is a new run against original retailer.
  update public.grocery_agent_runs set lease_expires_at=clock_timestamp()-interval '1 second' where run_id=run_a;
  update public.grocery_agent_cart_leases set expires_at=clock_timestamp()-interval '1 second' where run_id=run_a;
  update public.grocery_agent_attempts set lease_expires_at=clock_timestamp()-interval '1 second' where run_id=run_a;
  op:=jsonb_build_object('phase','prepare','operation_id',prefix||'-expired','run_id',run_a,
    'request_id',request_c,'revision',1,'retailer','Wegmans','product',product,'observed_cart','[]'::jsonb,
    'observed_at',stamp,'worker_token',prepared->>'worker_token');
  result:=public.grocery_agent_progress(op);
  if result->>'code'<>'lease_expired' then raise exception 'expired run could prepare: %',result; end if;
  snap:=public.grocery_agent_list_pending(run_c);
  if not exists(select 1 from jsonb_array_elements(snap->'requests') s where s->>'id'=request_d::text and jsonb_array_length(s->'attempts')>0) then
    raise exception 'unresolved intent missing from new run';
  end if;
  op:=jsonb_build_object('phase','complete','operation_id',prefix||'-recovery-edited','run_id',run_c,
    'request_id',request_d,'revision',2,'retailer','Wegmans','outcome','already_in_cart','product',product,
    'observed_at',stamp,'recovery_attempt_id',prepared->>'attempt_id');
  result:=public.grocery_agent_progress(op);
  if result->>'code'<>'revision_conflict' or result->>'evidence_recorded'<>'true' then
    raise exception 'recovery must preserve evidence without fulfilling changed revision: %',result;
  end if;
  if (select status from public.grocery_items where id=request_d)<>'needed' then raise exception 'recovery fulfilled changed request'; end if;

  -- External success with lost acknowledgement: preserve the intent, wait out
  -- its lease, then reconcile a current cart read without preparing a new add.
  insert into public.grocery_items(name,quantity,added_by) values('Synthetic lost acknowledgement','1 package','test') returning id into request_lost_ack;
  perform public.grocery_agent_list_pending(run_d);
  op:=jsonb_build_object('phase','prepare','operation_id',prefix||'-prep-lost-ack','run_id',run_d,
    'request_id',request_lost_ack,'revision',1,'retailer','Morton Williams Supermarket','product',product,
    'observed_cart','[]'::jsonb,'observed_at',stamp);
  prepared:=public.grocery_agent_progress(op);
  if prepared->>'ok'<>'true' then raise exception 'lost-ack preparation failed: %',prepared; end if;
  perform public.grocery_agent_list_pending(run_e);
  op:=jsonb_build_object('phase','complete','operation_id',prefix||'-recover-lost-ack','run_id',run_e,
    'request_id',request_lost_ack,'revision',1,'retailer','Morton Williams Supermarket','outcome','already_in_cart',
    'product',product,'observed_at',stamp,'recovery_attempt_id',prepared->>'attempt_id');
  result:=public.grocery_agent_progress(op);
  if result->>'code'<>'claim_active' then raise exception 'active claim recovered before worker stopped'; end if;
  update public.grocery_agent_runs set lease_expires_at=clock_timestamp()-interval '1 second' where run_id=run_d;
  update public.grocery_agent_cart_leases set expires_at=clock_timestamp()-interval '1 second' where run_id=run_d;
  update public.grocery_agent_attempts set lease_expires_at=clock_timestamp()-interval '1 second' where run_id=run_d;
  result:=public.grocery_agent_progress(op);
  if result->>'ok'<>'true' or result->>'status'<>'in_cart' then raise exception 'lost acknowledgement recovery failed: %',result; end if;
  if (select count(*) from public.grocery_agent_attempts where request_id=request_lost_ack and intent is not null)<>1 then
    raise exception 'recovery generated another add intent';
  end if;
  if exists(select 1 from public.grocery_agent_attempts where request_id=request_lost_ack and requires_reconciliation) then
    raise exception 'successful recovery left original attempt unresolved';
  end if;

  -- Cancellation invalidates the snapshot and prevents preparation.
  update public.grocery_items set status='cancelled' where id=request_c;
  op:=jsonb_build_object('phase','prepare','operation_id',prefix||'-cancelled','run_id',run_c,
    'request_id',request_c,'revision',1,'retailer','Wegmans','product',product,'observed_cart','[]'::jsonb,'observed_at',stamp);
  result:=public.grocery_agent_progress(op);
  if result->>'code'<>'revision_conflict' then raise exception 'cancelled request could prepare'; end if;
  result:=public.grocery_agent_progress(op||jsonb_build_object('operation_id',prefix||'-invalid-product','product','invalid'));
  if result->>'code'<>'invalid_input' then raise exception 'invalid product was accepted'; end if;
  result:=public.grocery_agent_progress(op||jsonb_build_object('operation_id',prefix||'-invalid-qty','product',product||'{"quantity":1.5}'::jsonb));
  if result->>'code'<>'invalid_input' then raise exception 'fractional package quantity accepted'; end if;
  result:=public.grocery_agent_progress(op||jsonb_build_object('operation_id',prefix||'-unknown-field','checkout',true));
  if result->>'code'<>'invalid_input' then raise exception 'unknown input accepted'; end if;
  if has_function_privilege('anon','public.grocery_agent_list_pending(text)','execute')
    or has_function_privilege('authenticated','public.grocery_agent_progress(jsonb)','execute') then
    raise exception 'RPC exposed to unprivileged roles';
  end if;
  if not has_function_privilege('service_role','public.grocery_agent_progress(jsonb)','execute') then
    raise exception 'service role lacks RPC access';
  end if;
  select count(*) into n from public.grocery_items where id in(request_a,request_b,request_c,request_d,request_late)
    and status in('ordered','got');
  if n<>0 then raise exception 'connector inferred ordered/received'; end if;
  raise notice 'grocery_agent: snapshot, replay, leases, ownership, stale receipts, recovery, cancellation, validation and grants passed';
end;
$$;
rollback;
