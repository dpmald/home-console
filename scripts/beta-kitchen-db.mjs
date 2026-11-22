// Called only after the launcher verifies the dedicated loopback database container.
import { execFileSync } from 'node:child_process';
import { prepareBetaSchema } from './prepare-beta-schema.mjs';
import { validateGroceryDevelopmentDatabase } from '../lib/grocery-dev-isolation.mjs';
import { localBetaRestCredentials } from '../lib/beta-local-rest.mjs';

const network = 'home-console-beta-kitchen';
const database = 'home-console-grocery-dev';
const rest = 'home-console-beta-rest';
const owner = 'beta-kitchen';
const image = 'public.ecr.aws/supabase/postgrest:v16.5';

export async function ensureBetaKitchen(config, host, dockerEnv) {
  const url = validateGroceryDevelopmentDatabase(config.HOME_CONSOLE_GROCERY_DEV_DATABASE_URL);
  const credentials = localBetaRestCredentials(url);
  function docker(args, extraEnv = {}) {
    try {
      return execFileSync('docker', ['--host', host, ...args], {
        env: { ...dockerEnv, ...extraEnv }, encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'],
      }).trim();
    } catch { throw new Error('Beta Docker setup failed during ' + args[0]); }
  }
  const dbInfo = JSON.parse(docker(['inspect', database]))[0];
  const binding = dbInfo.HostConfig.PortBindings['5432/tcp'];
  if (dbInfo.Config.Labels['home-console.scope'] !== 'grocery-agent-development' ||
      binding?.length !== 1 || binding[0].HostIp !== '127.0.0.1' || binding[0].HostPort !== '55432') {
    throw new Error('Unexpected local beta database identity');
  }
  if (!docker(['network','ls','--filter','name=^'+network+'$','--format','{{.Name}}'])) {
    docker(['network','create','--label','home-console.scope='+owner,network]);
  }
  const net = JSON.parse(docker(['network','inspect',network]))[0];
  if (net.Labels?.['home-console.scope'] !== owner || net.Driver !== 'bridge') throw new Error('Unexpected beta network');
  if (!dbInfo.NetworkSettings.Networks[network]) docker(['network','connect',network,database]);

  await prepareBetaSchema(url);

  if (!docker(['ps','-a','--filter','name=^/'+rest+'$','--format','{{.Names}}'])) {
    docker(['run','-d','--name',rest,'--label','home-console.scope='+owner,'--network',network,
      '--restart','unless-stopped','--publish','127.0.0.1:55433:3000','--env','PGRST_DB_URI',
      '--env','PGRST_JWT_SECRET','--env','PGRST_DB_SCHEMAS=public',image], {
      PGRST_DB_URI:'postgres://beta_rest:'+credentials.password+'@'+database+':5432/home_console_grocery_dev',
      PGRST_JWT_SECRET:credentials.jwtSecret,
    });
  }
  const api = JSON.parse(docker(['inspect',rest]))[0];
  const port = api.HostConfig.PortBindings['3000/tcp'];
  if (api.Config.Labels?.['home-console.scope'] !== owner || api.Config.Image !== image ||
      !api.NetworkSettings.Networks[network] || port?.length !== 1 || port[0].HostIp !== '127.0.0.1' ||
      port[0].HostPort !== '55433') throw new Error('Unexpected beta REST service');
  if (!api.State.Running) docker(['start',rest]);
  // Startup waits for PostgREST to connect and load its schema.
  for (let i=0; i<30; i++) {
    const response = await fetch('http://127.0.0.1:55433/wesley_chore_templates?select=id&limit=1',
      {headers:{Authorization:'Bearer '+credentials.token},signal:AbortSignal.timeout(1500)}).catch(()=>null);
    if (response?.ok) return;
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  throw new Error('Local beta REST service did not become ready');
}
