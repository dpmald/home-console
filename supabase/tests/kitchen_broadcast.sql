-- Record calls to the Realtime transport while exercising real Postgres triggers.
-- The transport double and all test rows are scoped to this transaction.
begin;
create temporary table sent (payload jsonb, event text, topic text);
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$ insert into pg_temp.sent values ($1, $2, $3) $$;

insert into dinner_schedule(date) values ('2099-01-01');
update dinner_schedule set chef = 'daniela' where date = '2099-01-01';
insert into grocery_items(name) values ('Synthetic first'), ('Synthetic second');
do $$ begin
  if (select count(*) from pg_temp.sent) <> 2 or
      (select count(distinct payload->>'table') from pg_temp.sent where event='db_change' and topic='kitchen') <> 2
    then raise exception 'Expected one broadcast per changed table in a transaction'; end if;
end $$;
rollback;

begin;
create temporary table sent (payload jsonb);
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$ insert into pg_temp.sent values ($1) $$;
-- Seed without consuming the first genuine change under test.
set local session_replication_role = replica;
insert into dinner_schedule(date) values ('2099-01-01');
set local session_replication_role = origin;
insert into dinner_schedule(date) values ('2099-01-01') on conflict do nothing;
update dinner_schedule set chef=chef where date='2099-01-01';
do $$ begin
  if exists (select from pg_temp.sent) then raise exception 'No-op writes broadcast'; end if;
end $$;
update dinner_schedule set chef='daniela' where date='2099-01-01';
do $$ begin
  if (select count(*) from pg_temp.sent) <> 1 then raise exception 'First real change after no-op was lost'; end if;
end $$;
rollback;
