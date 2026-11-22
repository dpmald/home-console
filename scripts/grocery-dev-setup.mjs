// Dedicated synthetic-data database; does not inspect or modify hosted Supabase.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { groceryMigrations, legacyGroceryMigrations, migrationAlreadyApplied } from './grocery-migrations.mjs';
import { validateGroceryDevelopmentDatabase, groceryDockerEnvironment } from '../lib/grocery-dev-isolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const credentialsPath = path.join(root, '.env.grocery-dev.local');
const dockerEnvPath = path.join(root, '.env.grocery-docker.local');
const containerName = 'home-console-grocery-dev';
let dockerHost;
const dockerEnvironment = groceryDockerEnvironment(process.env);
const docker = (args, options = {}) => execFileSync('docker', dockerHost ? ['--host', dockerHost, ...args] : args, {
  cwd: root, env: dockerEnvironment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...options,
});
const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
}));

const contexts = JSON.parse(docker(['context', 'inspect']));
if (contexts.length !== 1 || !['npipe:////./pipe/dockerDesktopLinuxEngine', 'unix:///var/run/docker.sock'].includes(contexts[0].Endpoints?.docker?.Host)) {
  throw new Error('Grocery development requires a local Docker engine');
}
dockerHost = contexts[0].Endpoints.docker.Host;
if (!existsSync(credentialsPath)) {
  const password = randomBytes(24).toString('hex');
  const credential = randomBytes(32).toString('hex');
  writeFileSync(credentialsPath, `HOME_CONSOLE_GROCERY_AGENT_KEY=${credential}\nHOME_CONSOLE_GROCERY_DEV_DATABASE_URL=postgresql://postgres:${password}@127.0.0.1:55432/home_console_grocery_dev\n`, { mode: 0o600, flag: 'wx' });
}
const env = parseEnv(readFileSync(credentialsPath, 'utf8'));
const url = new URL(validateGroceryDevelopmentDatabase(env.HOME_CONSOLE_GROCERY_DEV_DATABASE_URL));
if (url.username !== 'postgres' || !/^[a-f0-9]{48}$/.test(url.password)) {
  throw new Error('Refusing non-dedicated grocery development database');
}
writeFileSync(dockerEnvPath, `POSTGRES_PASSWORD=${url.password}\nPOSTGRES_DB=home_console_grocery_dev\n`, { mode: 0o600 });
let existing;
try { existing = JSON.parse(docker(['inspect', containerName]))[0]; } catch { /* Expected before first create. */ }
if (existing) {
  if (existing.Config?.Labels?.['home-console.scope'] !== 'grocery-agent-development') throw new Error('Container name is owned by another task');
  const binding = existing.HostConfig?.PortBindings?.['5432/tcp'];
  if (binding?.length !== 1 || binding[0].HostIp !== '127.0.0.1' || binding[0].HostPort !== '55432') throw new Error('Unexpected development port binding');
  if (!existing.State?.Running) docker(['start', containerName]);
} else {
  docker(['run', '-d', '--name', containerName, '--label', 'home-console.scope=grocery-agent-development',
    '--publish', '127.0.0.1:55432:5432', '--env-file', dockerEnvPath,
    '--mount', 'type=volume,source=home-console-grocery-dev-db,target=/var/lib/postgresql/data', 'postgres:17-alpine'], { timeout: 180000 });
}
let client;
for (let attempt = 0; attempt < 40; attempt++) {
  client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 1500 });
  try { await client.connect(); break; } catch {
    await client.end().catch(() => {});
    client = undefined;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
if (!client) throw new Error('Dedicated development database did not become ready');
try {
  await client.query(`create table if not exists public.grocery_dev_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set((await client.query('select name from public.grocery_dev_migrations')).rows.map(row => row.name));
  for (const name of groceryMigrations) {
    const legacy = legacyGroceryMigrations[name];
    if (legacy && !readFileSync(path.join(root, name)).equals(readFileSync(path.join(root, 'supabase/legacy/grocery-development', path.basename(legacy))))) {
      throw new Error('Grocery migration lineage differs; review instead of replaying initialization');
    }
    if (migrationAlreadyApplied(name, applied)) continue;
    await client.query('begin');
    try {
      await client.query(readFileSync(path.join(root, name), 'utf8'));
      await client.query('insert into public.grocery_dev_migrations(name) values($1)', [name]);
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; }
  }
  if (process.argv.includes('--seed')) {
    await client.query('begin');
    await client.query("set local home_console.grocery_cart_actor = 'device'");
    await client.query(`insert into public.grocery_items(id,name,quantity,added_by,notes) values
      ('00000000-0000-4000-8000-000000000101','Synthetic test milk','2 packages','Development fixture','Synthetic request; never use a real cart'),
      ('00000000-0000-4000-8000-000000000102','Synthetic test paper towels',null,'Development fixture','Synthetic request; never use a real cart') on conflict(id) do nothing`);
    await client.query('commit');
  }
  console.log('Dedicated grocery database ready at 127.0.0.1:55432. Synthetic data only.');
  console.log('Credential file: .env.grocery-dev.local (ignored by Git; values not printed).');
} finally { await client.end(); }
