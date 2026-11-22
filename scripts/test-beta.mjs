import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { groceryDockerEnvironment } from '../lib/grocery-dev-isolation.mjs';
import { localBetaRestCredentials } from '../lib/beta-local-rest.mjs';
import { groceryUiEnvironment } from './grocery-ui-environment.mjs';
import { prepareBetaSchema } from './prepare-beta-schema.mjs';

const dockerEnv = groceryDockerEnvironment(process.env);
const [context] = JSON.parse(execFileSync('docker', ['context', 'inspect'], { env: dockerEnv }));
const host = context.Endpoints.docker.Host;
if (!['npipe:////./pipe/dockerDesktopLinuxEngine', 'unix:///var/run/docker.sock'].includes(host)) {
  throw new Error('A local Docker engine is required for Beta tests');
}

const password = randomBytes(24).toString('hex');
const database = 'postgresql://postgres:' + password + '@127.0.0.1:55442/home_console_pr_test';
const rest = localBetaRestCredentials(database);
const project = 'kitchen-test-' + randomUUID();
function compose(...args) {
  execFileSync('docker', ['--host', host, 'compose', '-p', project, '-f', 'tests/integration/compose.yml', ...args], {
    stdio: 'inherit', windowsHide: true,
    env: { ...dockerEnv, POSTGRES_PASSWORD: password, PGRST_JWT_SECRET: rest.jwtSecret,
      PGRST_DB_URI: 'postgres://beta_rest:' + rest.password + '@db:5432/home_console_pr_test' },
  });
}

const names = [...readFileSync('.env.example', 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]);
const env = groceryUiEnvironment(process.env, names, {
  HOME_CONSOLE_GROCERY_DEV_DATABASE_URL: database, HOME_CONSOLE_GROCERY_AGENT_KEY: randomBytes(32).toString('hex'),
}, true);
env.KIOSK_ACCESS_TOKEN = randomBytes(32).toString('hex');
env.HOME_CONSOLE_PR_DATABASE_URL = database;
env.NEXT_PUBLIC_FAMILY_TIMEZONE = 'America/New_York';

try {
  compose('up', '-d', '--wait', 'db');
  const client = new pg.Client({ connectionString: database });
  await client.connect();
  try {
    await client.query(readFileSync('supabase/tests/grocery_agent_bootstrap.sql', 'utf8'));
    for (const file of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort()) {
      await client.query(readFileSync('supabase/migrations/' + file, 'utf8'));
    }
    await client.query(readFileSync('supabase/tests/kitchen_broadcast.sql', 'utf8'));
    console.log('PASS: unchanged writes stay quiet and kitchen broadcasts are deduplicated.');
  } finally { await client.end(); }
  await prepareBetaSchema(database);
  compose('up', '-d', 'rest');
  for (let i = 0; ; i++) {
    const response = await fetch(rest.restUrl + '/wesley_chore_templates?select=id&limit=1', {
      headers: { Authorization: 'Bearer ' + rest.token }, signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    if (response?.ok) break;
    if (i >= 60) throw new Error('Disposable PostgREST service failed to become ready');
    await delay(500);
  }

  for (const args of [['scripts/grocery-flow-check.ts'], ['--test', 'tests/integration/beta.test.ts']]) {
    execFileSync(process.execPath, ['--import', 'tsx', ...args], { env, stdio: 'inherit', windowsHide: true });
  }
} finally {
  compose('down', '--volumes');
}
