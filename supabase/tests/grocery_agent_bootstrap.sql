-- TEST DATABASE ONLY. Run before the real 0001 migration in a dedicated, empty
-- vanilla PostgreSQL database. Supabase already provides these roles/schema.
-- The stub intentionally emits no realtime events; it cannot validate realtime.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists realtime;
create or replace function realtime.send(payload jsonb,event text,topic text,private boolean default true)
returns void language plpgsql as $$ begin return; end; $$;
grant usage on schema public to service_role;
