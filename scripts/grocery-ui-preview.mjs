import { readFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { groceryUiEnvironment } from './grocery-ui-environment.mjs';
import { groceryDockerEnvironment } from '../lib/grocery-dev-isolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = [...readFileSync(path.join(root, '.env.example'), 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1]);
const config = Object.fromEntries(readFileSync(path.join(root, '.env.grocery-dev.local'), 'utf8')
  .split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const at = line.indexOf('='); return [line.slice(0,at),line.slice(at+1)];
  }));
const dockerEnv = groceryDockerEnvironment(process.env);
const contexts = JSON.parse(execFileSync('docker', ['context','inspect'], {env:dockerEnv,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}));
const host = contexts[0]?.Endpoints?.docker?.Host;
if (contexts.length !== 1 || !['npipe:////./pipe/dockerDesktopLinuxEngine','unix:///var/run/docker.sock'].includes(host)) throw new Error('A local Docker engine is required');
const container = JSON.parse(execFileSync('docker', ['--host',host,'inspect','home-console-grocery-dev'], {env:dockerEnv,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}))[0];
const ports = container?.HostConfig?.PortBindings?.['5432/tcp'];
if (container?.Config?.Labels?.['home-console.scope'] !== 'grocery-agent-development' || !container.State.Running
  || ports?.length !== 1 || ports[0].HostIp !== '127.0.0.1' || ports[0].HostPort !== '55432') throw new Error('Dedicated synthetic database is not ready');
const env = groceryUiEnvironment(process.env, names, config);
const beta = process.argv.includes('--beta');
if (beta) {
  const { ensureBetaKitchen } = await import('./beta-kitchen-db.mjs');
  await ensureBetaKitchen(config, host, dockerEnv);
}
const port = beta ? '3005' : '3004';
const app = spawn(process.execPath, [path.join(root,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',port], {
  cwd:root, env, stdio:'inherit', windowsHide:true,
});
console.log(`Beta preview: http://localhost:${port}/beta?key=home-console-groceries-local-only`);
console.log('Groceries use the separate development database. Back to kitchen returns to localhost:3001. External integrations are disabled.');
app.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => app.kill(signal));
