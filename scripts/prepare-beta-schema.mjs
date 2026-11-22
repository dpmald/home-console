import pg from 'pg';
import { readFileSync } from 'node:fs';
import { localBetaRestCredentials } from '../lib/beta-local-rest.mjs';

export async function prepareBetaSchema(url) {
  const credentials = localBetaRestCredentials(url);
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis:4000 });
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtext('beta-kitchen-setup'))");
    await client.query(`do $$ begin
      if not exists(select from pg_roles where rolname='beta_kiosk') then create role beta_kiosk nologin bypassrls; end if;
      if not exists(select from pg_roles where rolname='beta_rest') then create role beta_rest login noinherit; end if;
    end $$`);
    // Generated hex only. Role passwords cannot be bound as ALTER ROLE parameters.
    await client.query("alter role beta_rest password '" + credentials.password + "'");
    await client.query(`grant beta_kiosk to beta_rest;
      grant usage on schema public to beta_kiosk;
      grant select,insert,update on dinner_schedule,fridge_backlog,wesley_chores,wesley_chore_templates,
        family_logistics,grocery_items,cart_proposals to beta_kiosk;
      alter table family_logistics add column if not exists description text;`);
    const seeded = await client.query('select 1 from wesley_chore_templates limit 1');
    if (!seeded.rowCount) await client.query(readFileSync(new URL('../supabase/seed.sql',import.meta.url),'utf8'));
    await client.query('commit');
  } finally { await client.end(); }
}
