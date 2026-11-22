-- Cart-only snapshots contain confirmed household revisions. The Saturday meal lane
-- can reconcile its earlier mutations but cannot claim new household requests.
create or replace function public.grocery_agent_list_pending(p_run_id text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_run public.grocery_agent_runs%rowtype;
  v_snapshot jsonb;
  v_requests jsonb;
  v_saturday boolean := lower(p_run_id) like 'sat-%';
  v_cart boolean := lower(p_run_id) like 'cart-%';
begin
  if p_run_id is null or p_run_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$' then
    return public.grocery_agent_error('invalid_input','run_id must be a bounded stable identifier.');
  end if;
  -- All connector mutations serialize; row locks below also coordinate UI edits.
  perform pg_advisory_xact_lock(73482910293847);
  select * into v_run from public.grocery_agent_runs where run_id = p_run_id;
  if not found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',g.id,'revision',g.revision,'name',g.name,'quantity',g.quantity,
      'notes',g.notes,'added_by',g.added_by,'created_at',g.created_at)
      order by g.created_at,g.id),'[]'::jsonb) into v_snapshot
    from (
      select g.* from public.grocery_items g
      where (not v_saturday and g.cart_authorized_revision = g.revision and
        (g.status='needed' or (not v_cart and g.status='needs_attention')))
        or exists (
          select 1 from public.grocery_agent_attempts a where a.request_id=g.id
          and a.requires_reconciliation and (not v_saturday or lower(a.run_id) like 'sat-%')
          and (not v_cart or a.outcome is null or g.status <> 'needs_attention'))
      order by g.created_at,g.id limit case when v_cart then 20 else 101 end
    ) g;
    -- Frequent polls should leave no run records when there is no work.
    if v_cart and v_snapshot='[]'::jsonb then
      return jsonb_build_object('ok',true,'queue_policy','authorized-revision-v1','run_id',p_run_id,
        'snapshot_at',clock_timestamp(),'retailer',null,'lease_expires_at',null,'requests',v_snapshot);
    end if;
    if jsonb_array_length(v_snapshot)>100 then
      return public.grocery_agent_error('too_many_requests','More than 100 pending requests; process the household list before starting this run.');
    end if;
    insert into public.grocery_agent_runs(run_id,snapshot_at,snapshot)
      values (p_run_id,clock_timestamp(),v_snapshot) returning * into v_run;
  end if;
  select coalesce(jsonb_agg(s.item || jsonb_build_object(
    'current_revision',g.revision,'current_status',g.status,
    'stale',g.id is null or g.revision<>(s.item->>'revision')::integer,
    'attempts',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'attempt_id',a.id,'run_id',a.run_id,'revision',a.revision,'retailer',a.retailer,
      'intent',a.intent,'outcome',a.outcome,'evidence',a.evidence,'obsolete',a.obsolete,
      'requires_reconciliation',a.requires_reconciliation,'lease_expires_at',a.lease_expires_at,
      'created_at',a.created_at,'completed_at',a.completed_at)) order by a.created_at)
      from public.grocery_agent_attempts a where a.request_id=(s.item->>'id')::uuid
      and (a.requires_reconciliation or a.run_id=p_run_id)), '[]'::jsonb))
    order by s.ordinality),'[]'::jsonb) into v_requests
  from jsonb_array_elements(v_run.snapshot) with ordinality s(item,ordinality)
  left join public.grocery_items g on g.id=(s.item->>'id')::uuid
  where (not v_saturday and g.cart_authorized_revision = (s.item->>'revision')::integer)
    or exists (select 1 from public.grocery_agent_attempts a where a.request_id=g.id
      and (a.requires_reconciliation or a.run_id=p_run_id) and (not v_saturday or lower(a.run_id) like 'sat-%'));
  return jsonb_build_object('ok',true,'queue_policy','authorized-revision-v1','run_id',p_run_id,'snapshot_at',v_run.snapshot_at,
    'retailer',v_run.retailer,'lease_expires_at',v_run.lease_expires_at,'requests',v_requests);
end;
$$;
revoke all on function public.grocery_agent_list_pending(text) from public, anon, authenticated;
grant execute on function public.grocery_agent_list_pending(text) to service_role;

create function public.grocery_agent_progress_impl(p_operation jsonb)
returns jsonb language plpgsql set search_path = pg_catalog as $$
declare
  v_op text;
  v_phase text;
  v_run_id text;
  v_id uuid;
  v_revision integer;
  v_retailer text;
  v_outcome text;
  v_observed timestamptz;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
  v_cached public.grocery_agent_operations%rowtype;
  v_run public.grocery_agent_runs%rowtype;
  v_request public.grocery_items%rowtype;
  v_attempt public.grocery_agent_attempts%rowtype;
  v_recovery public.grocery_agent_attempts%rowtype;
  v_lease public.grocery_agent_cart_leases%rowtype;
  v_stale boolean;
  v_is_prepared boolean;
  v_recovery_id uuid;
  v_authorized boolean;
  v_quick jsonb := p_operation->'quick_add';
begin
  if jsonb_typeof(p_operation) is distinct from 'object' or length(p_operation::text)>16000 then
    return public.grocery_agent_error('invalid_input','Operation must be a bounded object.');
  end if;
  if exists(select 1 from jsonb_object_keys(p_operation) k where k not in (
    'phase','operation_id','run_id','request_id','revision','retailer','worker_token','claim_token',
    'product','quick_add','observed_cart','observed_at','outcome','reason','cart_action_id','recovery_attempt_id')) then
    return public.grocery_agent_error('invalid_input','Unknown operation field.');
  end if;
  v_op := p_operation->>'operation_id'; v_phase:=p_operation->>'phase';
  v_run_id:=p_operation->>'run_id'; v_retailer:=p_operation->>'retailer';
  if coalesce(v_op,'') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
    or coalesce(v_run_id,'') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'
    or coalesce(v_phase,'') not in ('prepare','complete')
    or coalesce(v_retailer,'') not in ('Wegmans','Morton Williams Supermarket')
    or coalesce(p_operation->>'request_id','') !~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
    or jsonb_typeof(p_operation->'revision') is distinct from 'number'
    or coalesce(p_operation->>'revision','') !~ '^[1-9][0-9]{0,8}$' then
    return public.grocery_agent_error('invalid_input','Invalid operation identity, phase, retailer or revision.');
  end if;
  v_id:=(p_operation->>'request_id')::uuid; v_revision:=(p_operation->>'revision')::integer;
  perform pg_advisory_xact_lock(73482910293847);
  v_now:=clock_timestamp();
  select * into v_cached from public.grocery_agent_operations where operation_id=v_op;
  if found then
    if v_cached.payload<>p_operation then
      return public.grocery_agent_error('idempotency_conflict','operation_id was already used with different data.');
    end if;
    return v_cached.response || jsonb_build_object('replayed',true);
  end if;
  if p_operation ? 'worker_token' and coalesce(p_operation->>'worker_token','') !~
      '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
    or p_operation ? 'claim_token' and coalesce(p_operation->>'claim_token','') !~
      '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
    or p_operation ? 'recovery_attempt_id' and coalesce(p_operation->>'recovery_attempt_id','') !~
      '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
    or p_operation ? 'cart_action_id' and (jsonb_typeof(p_operation->'cart_action_id')<>'string'
      or length(p_operation->>'cart_action_id') not between 1 and 100)
    or p_operation ? 'reason' and (jsonb_typeof(p_operation->'reason')<>'string'
      or length(p_operation->>'reason')>500) then
    return public.grocery_agent_error('invalid_input','Invalid optional identifier or reason.');
  end if;
  if coalesce(p_operation->>'observed_at','') !~ '^\d{4}-\d{2}-\d{2}T' then
    return public.grocery_agent_error('invalid_input','observed_at must be an ISO timestamp.');
  end if;
  begin v_observed:=(p_operation->>'observed_at')::timestamptz;
  exception when others then
    return public.grocery_agent_error('invalid_input','observed_at must be an ISO timestamp.');
  end;
  if v_observed>v_now+interval '5 minutes' or v_observed<v_now-interval '1 day' then
    return public.grocery_agent_error('stale_observation','Use a current cart observation.');
  end if;
  if p_operation ? 'product' and not public.grocery_agent_product_valid(p_operation->'product') then
    return public.grocery_agent_error('invalid_input','Invalid product evidence.');
  end if;
  if v_phase='prepare' then
    if p_operation ? 'quick_add' then
      if jsonb_typeof(v_quick) is distinct from 'object' then
        return public.grocery_agent_error('invalid_input','Quick-add requires a search query and package count.');
      end if;
      if jsonb_typeof(v_quick->'query') is distinct from 'string'
        or length(btrim(v_quick->>'query')) not between 1 and 250
        or jsonb_typeof(v_quick->'quantity') is distinct from 'number'
        or (v_quick->>'quantity') !~ '^([1-9][0-9]?|100)$'
        or exists(select 1 from jsonb_object_keys(v_quick) k where k not in ('query','quantity')) then
        return public.grocery_agent_error('invalid_input','Quick-add requires a bounded search query and 1-100 packages.');
      end if;
    end if;
    if (p_operation ? 'quick_add') = (p_operation ? 'product')
      or jsonb_typeof(p_operation->'observed_cart') is distinct from 'array'
      or p_operation ? 'outcome' or p_operation ? 'recovery_attempt_id' or p_operation ? 'claim_token' then
      return public.grocery_agent_error('invalid_input','Prepare requires exactly one product or quick_add intent and observed_cart, without a final outcome or recovery ID.');
    end if;
    if jsonb_array_length(p_operation->'observed_cart')>20
      or exists(select 1 from jsonb_array_elements(p_operation->'observed_cart') x
        where not public.grocery_agent_product_valid(x,true)) then
      return public.grocery_agent_error('invalid_input','observed_cart must contain at most 20 bounded product lines.');
    end if;
    if v_observed<v_now-interval '5 minutes' then
      return public.grocery_agent_error('stale_observation','Read the selected cart again before preparing an addition.');
    end if;
  else
    v_outcome:=p_operation->>'outcome';
    if coalesce(v_outcome,'') not in ('in_cart','already_in_cart','pending','needs_attention')
      or (v_outcome in ('in_cart','already_in_cart') and not public.grocery_agent_product_valid(p_operation->'product'))
      or (v_outcome in ('pending','needs_attention') and length(btrim(coalesce(p_operation->>'reason','')))=0)
      or p_operation ? 'observed_cart' or p_operation ? 'quick_add' then
      return public.grocery_agent_error('invalid_input','Complete requires a valid outcome, product coverage or unresolved reason.');
    end if;
  end if;
  select * into v_run from public.grocery_agent_runs where run_id=v_run_id for update;
  if not found then return public.grocery_agent_error('snapshot_required','Call list_pending for this run first.'); end if;
  if not exists(select 1 from jsonb_array_elements(v_run.snapshot) s
      where s->>'id'=v_id::text and (s->>'revision')::integer=v_revision) then
    return public.grocery_agent_error('not_in_snapshot','Request revision is not a member of this run snapshot.');
  end if;
  select * into v_request from public.grocery_items where id=v_id for update;
  if not found then return public.grocery_agent_error('request_missing','The request no longer exists.'); end if;
  v_stale:=v_request.revision<>v_revision or v_request.status in ('cancelled','got','ordered');
  select * into v_attempt from public.grocery_agent_attempts
    where run_id=v_run_id and request_id=v_id and revision=v_revision for update;
  v_is_prepared:=found and v_attempt.intent is not null;

  if lower(v_run_id) like 'cart-%' and v_outcome='already_in_cart'
    and not v_is_prepared and not (p_operation ? 'recovery_attempt_id') then
    return public.grocery_agent_error('claim_required','Each new household request contributes its own package count. An existing line confirms only a prior claim for this request.');
  end if;

  -- Recheck the revision under the item lock immediately before allowing a cart action.
  v_authorized := lower(v_run_id) not like 'sat-%'
    and v_request.cart_authorized_revision is not distinct from v_revision;
  if not v_authorized then
    if v_phase='prepare' or (not v_is_prepared and not (p_operation ? 'recovery_attempt_id')) then
      if v_stale then return public.grocery_agent_error('revision_conflict','The request changed; leave the current revision untouched.'); end if;
      return public.grocery_agent_error('untrusted_request','This revision requires confirmation on the household grocery list.');
    end if;
    -- Keep evidence from a prior claim without fulfilling a newer or unauthorized request.
    v_stale := true;
  end if;

  if v_phase='prepare' then
    if v_stale then return public.grocery_agent_error('revision_conflict','The request changed; do not add anything.'); end if;
    if v_request.status<>'needed' then return public.grocery_agent_error('request_not_pending','The request is already covered or needs household attention.'); end if;
    if v_attempt.id is not null then return public.grocery_agent_error('attempt_exists','Replay the original operation_id or reconcile its attempt; do not prepare another addition.'); end if;
    if exists(select 1 from public.grocery_agent_attempts where request_id=v_id and requires_reconciliation) then
      return public.grocery_agent_error('reconciliation_required','Read the original retailer cart and complete recovery before another addition.');
    end if;
    if v_run.retailer is not null and v_run.retailer<>v_retailer then
      return public.grocery_agent_error('retailer_conflict','The selected retailer is pinned for this run.');
    end if;
    if v_run.worker_token is not null then
      if v_run.worker_token::text is distinct from p_operation->>'worker_token' then
        return public.grocery_agent_error('worker_conflict','An existing run requires its worker token.');
      end if;
      if v_run.lease_expires_at<=v_now then return public.grocery_agent_error('lease_expired','This run expired; stop additions and reconcile in a new run.'); end if;
    else
      if p_operation ? 'worker_token' or p_operation ? 'claim_token' then
        return public.grocery_agent_error('invalid_token','The first preparation must not supply invented tokens.');
      end if;
      select * into v_lease from public.grocery_agent_cart_leases where retailer=v_retailer for update;
      if found and v_lease.expires_at>v_now and v_lease.run_id<>v_run_id then
        return public.grocery_agent_error('cart_busy','Another run holds the selected cart lease; do not add anything. Wait until lease_expires_at, then read the cart again before a new prepare.',true)
          || jsonb_build_object('retailer',v_lease.retailer,'blocking_run_id',v_lease.run_id,
            'lease_expires_at',v_lease.expires_at,
            'retry_after_seconds',greatest(1,ceil(extract(epoch from (v_lease.expires_at-v_now)))::integer));
      end if;
      update public.grocery_agent_runs set retailer=v_retailer,worker_token=gen_random_uuid(),
        lease_expires_at=v_now+interval '15 minutes' where run_id=v_run_id returning * into v_run;
      insert into public.grocery_agent_cart_leases(retailer,run_id,expires_at)
        values(v_retailer,v_run_id,v_run.lease_expires_at)
        on conflict(retailer) do update set run_id=excluded.run_id,expires_at=excluded.expires_at;
    end if;
    insert into public.grocery_agent_attempts(run_id,request_id,revision,retailer,claim_token,
      lease_expires_at,intent,requires_reconciliation)
      values(v_run_id,v_id,v_revision,v_retailer,gen_random_uuid(),v_run.lease_expires_at,
        jsonb_strip_nulls(jsonb_build_object('product',p_operation->'product','quick_add',v_quick,'observed_cart',p_operation->'observed_cart',
          'observed_at',v_observed,'cart_action_id',p_operation->>'cart_action_id')),true)
      returning * into v_attempt;
    v_result:=jsonb_build_object('ok',true,'phase','prepare','run_id',v_run_id,'request_id',v_id,
      'revision',v_revision,'attempt_id',v_attempt.id,'worker_token',v_run.worker_token,
      'claim_token',v_attempt.claim_token,'lease_expires_at',v_run.lease_expires_at,
      'retailer',v_retailer,'status','prepared');
  else
    if p_operation ? 'recovery_attempt_id' then
      v_recovery_id:=(p_operation->>'recovery_attempt_id')::uuid;
      select * into v_recovery from public.grocery_agent_attempts where id=v_recovery_id and request_id=v_id for update;
      if not found or not v_recovery.requires_reconciliation or v_recovery.run_id=v_run_id then
        return public.grocery_agent_error('invalid_recovery','Recovery must reference an unresolved prior run attempt for this request.');
      end if;
      if v_recovery.lease_expires_at>v_now then
        return public.grocery_agent_error('claim_active','The prior worker may still be adding; wait for expiry before recovery.',true);
      end if;
      if v_recovery.retailer<>v_retailer or v_outcome='in_cart' then
        return public.grocery_agent_error('invalid_recovery','Recovery reads the original retailer and must not claim a new addition.');
      end if;
      if v_attempt.id is not null then return public.grocery_agent_error('attempt_exists','This run already recorded an attempt for this request.'); end if;
      v_stale:=v_stale or v_recovery.revision<>v_revision;
    elsif v_run.retailer is not null and v_run.retailer<>v_retailer then
      return public.grocery_agent_error('retailer_conflict','The selected retailer is pinned for this run.');
    end if;
    if v_recovery_id is null and v_run.retailer is null then
      update public.grocery_agent_runs set retailer=v_retailer where run_id=v_run_id returning * into v_run;
    end if;
    if v_attempt.id is not null and v_attempt.completed_at is not null then
      return public.grocery_agent_error('terminal_conflict','A final receipt already exists; retry only the original operation_id.');
    end if;
    if v_is_prepared then
      if v_attempt.claim_token::text is distinct from p_operation->>'claim_token'
        or v_run.worker_token::text is distinct from p_operation->>'worker_token' then
        return public.grocery_agent_error('invalid_token','Completion requires the original worker and claim tokens.');
      end if;
      -- Expiry forbids another cart mutation, but accepting evidence prevents loss
      -- of an external result that already happened before this call arrived.
      if v_attempt.lease_expires_at<=v_now then v_stale:=true; end if;
    elsif v_outcome='in_cart' then
      return public.grocery_agent_error('prepare_required','An added-to-cart result requires a prepared intent.');
    elsif p_operation ? 'worker_token' or p_operation ? 'claim_token' then
      return public.grocery_agent_error('invalid_token','There is no prepared attempt for these tokens.');
    end if;
    if not v_is_prepared and v_recovery_id is null and exists(
      select 1 from public.grocery_agent_attempts where request_id=v_id and requires_reconciliation) then
      return public.grocery_agent_error('reconciliation_required','Use recovery_attempt_id to reconcile the outstanding cart attempt.');
    end if;
    if not v_is_prepared and v_recovery_id is null and v_stale then
      return public.grocery_agent_error('revision_conflict','The request changed; leave the current revision untouched.');
    end if;
    if not v_is_prepared then
      insert into public.grocery_agent_attempts(run_id,request_id,revision,retailer)
        values(v_run_id,v_id,v_revision,v_retailer) returning * into v_attempt;
    end if;
    update public.grocery_agent_attempts set outcome=v_outcome,
      evidence=jsonb_strip_nulls(jsonb_build_object('product',p_operation->'product',
        'observed_at',v_observed,'reason',p_operation->>'reason','recovery_attempt_id',v_recovery_id)),
      obsolete=v_stale,completed_at=v_now,
      requires_reconciliation=(v_is_prepared and (v_stale or v_outcome='needs_attention'))
      where id=v_attempt.id returning * into v_attempt;
    if v_recovery_id is not null and v_outcome<>'needs_attention' then
      update public.grocery_agent_attempts set requires_reconciliation=false,recovered_by=v_attempt.id
        where id=v_recovery_id;
    end if;
    if not v_stale then
      if v_outcome in ('in_cart','already_in_cart') then
        update public.grocery_items set status='in_cart' where id=v_id;
      elsif v_outcome='needs_attention' then
        update public.grocery_items set status='needs_attention' where id=v_id;
      end if;
    end if;
    if v_stale then
      v_result:=public.grocery_agent_error('revision_conflict','Evidence retained as an obsolete attempt; the current request was not fulfilled.')
        || jsonb_build_object('attempt_id',v_attempt.id,'evidence_recorded',true,'current_revision',v_request.revision);
    else
      select * into v_request from public.grocery_items where id=v_id;
      v_result:=jsonb_strip_nulls(jsonb_build_object('ok',true,'phase','complete','run_id',v_run_id,
        'request_id',v_id,'revision',v_revision,'attempt_id',v_attempt.id,'outcome',v_outcome,
        'status',v_request.status,'retailer',v_retailer,'worker_token',case when v_is_prepared then v_run.worker_token end,
        'claim_token',case when v_is_prepared then v_attempt.claim_token end,
        'lease_expires_at',case when v_is_prepared then v_run.lease_expires_at end));
    end if;
  end if;
  if lower(v_run_id) like 'cart-%' and v_phase='complete' and v_run.worker_token is not null
    and not exists (select 1 from public.grocery_agent_attempts a where a.run_id=v_run_id
      and a.intent is not null and (a.completed_at is null or a.requires_reconciliation))
    and not exists (
      select 1 from jsonb_array_elements(v_run.snapshot) s join public.grocery_items g
        on g.id=(s->>'id')::uuid and g.revision=(s->>'revision')::integer
      where g.cart_authorized_revision=g.revision and g.status='needed'
        and not exists (select 1 from public.grocery_agent_attempts a where a.run_id=v_run_id
          and a.request_id=g.id and a.revision=g.revision and a.completed_at is not null)
    ) then
    -- Every eligible member is finished. Close both halves of the fixed lease.
    update public.grocery_agent_cart_leases set expires_at=v_now
      where run_id=v_run_id and retailer=v_run.retailer and expires_at>v_now;
    update public.grocery_agent_runs set lease_expires_at=v_now where run_id=v_run_id and lease_expires_at>v_now;
    v_result := v_result || jsonb_build_object('lease_expires_at',v_now);
  end if;
  v_result := v_result || jsonb_build_object('queue_policy','authorized-revision-v1');
  insert into public.grocery_agent_operations(operation_id,payload,response) values(v_op,p_operation,v_result);
  return v_result;
end;
$$;
revoke all on function public.grocery_agent_progress_impl(jsonb) from public, anon, authenticated, service_role;

create or replace function public.grocery_agent_progress(p_operation jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  previous_actor text;
  result jsonb;
begin
  previous_actor := public.grocery_cart_set_actor('agent');
  result := public.grocery_agent_progress_impl(p_operation);
  perform public.grocery_cart_set_actor(previous_actor);
  return result;
end;
$$;
revoke all on function public.grocery_agent_progress(jsonb) from public, anon, authenticated;
grant execute on function public.grocery_agent_progress(jsonb) to service_role;
