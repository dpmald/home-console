-- These fixtures roll back inside the isolated grocery database.
begin;
do $$
declare
  legacy uuid;
  trusted uuid;
  result jsonb;
  saved_revision integer;
begin
  insert into public.grocery_items(name,cart_authorized_revision) values ('Synthetic old request',1) returning id into legacy;
  select cart_authorized_revision into saved_revision from public.grocery_items where id=legacy;
  if saved_revision is not null then raise exception 'Untrusted add received authorization'; end if;

  result := public.grocery_trusted_device_mutate(jsonb_build_object('action','add','added_by','kiosk',
    'operation_id',gen_random_uuid()::text,'items','[{"name":"Synthetic household request","quantity":"1"}]'::jsonb));
  trusted := (result->'added_ids'->>0)::uuid;
  if trusted is null or not exists(select 1 from public.grocery_items where id=trusted and cart_authorized_revision=revision) then
    raise exception 'Trusted add did not authorize its revision';
  end if;
  begin
    perform public.grocery_device_mutate(jsonb_build_object('action','status','id',trusted,'revision',1,'status','cancelled'));
    raise exception 'Old device RPC cancelled a trusted row';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.grocery_items set name='Synthetic tampered' where id=trusted;
    raise exception 'Untrusted direct edit succeeded';
  exception when insufficient_privilege then null;
  end;
  update public.grocery_items set quantity='3' where id=legacy;
  result := public.grocery_trusted_device_mutate(jsonb_build_object('action','authorize','id',legacy,'revision',1));
  if result->>'code' is distinct from 'revision_conflict' then raise exception 'Stale confirmation succeeded'; end if;
  result := public.grocery_trusted_device_mutate(jsonb_build_object('action','authorize','id',legacy,'revision',2));
  if result->>'ok' is distinct from 'true' or not exists(select 1 from public.grocery_items where id=legacy and cart_authorized_revision=2) then
    raise exception 'Explicit confirmation failed';
  end if;
  if has_function_privilege('anon','public.grocery_trusted_device_mutate(jsonb)','execute')
    or has_function_privilege('authenticated','public.grocery_trusted_device_mutate(jsonb)','execute') then
    raise exception 'Trusted device RPC is public';
  end if;
end;
$$;
rollback;
