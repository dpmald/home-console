import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isBetaPathAllowed } from '../lib/beta-deployment';

const guides = ['README.md', 'AGENTS.md', 'docs/COLLABORATION.md', 'docs/TESTING.md',
  'docs/BETA-DEVELOPMENT.md', 'docs/LOCAL-DEVELOPMENT.md', 'docs/DOTTY-PR-APPROVAL.md'];
const read = (file: string) => readFileSync(file, 'utf8');
const scripts = JSON.parse(read('package.json')).scripts;
const errors: string[] = [];
for (const guide of guides) {
  const doc = read(guide);
  for (const [, script] of doc.matchAll(/\bnpm run ([\w:-]+)/g)) {
    if (!Object.hasOwn(scripts, script)) errors.push(guide + ' names missing npm script ' + script);
  }
  for (const [, target] of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(?:[a-z]+:|#|\/\/)/i.test(target)) continue;
    const file = decodeURIComponent(target.split('#')[0]);
    if (!existsSync(resolve(dirname(guide), file))) errors.push(guide + ' links to missing file ' + target);
  }
}

// Direct reads in application code are also the list the offline test launcher needs to scrub.
const settings = new Set([...read('.env.example').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]));
const runtimeOnly = new Set(['NODE_ENV', 'HOME_CONSOLE_PR_DATABASE_URL']);
const sources = execFileSync('git', ['ls-files', 'app', 'components', 'lib', 'middleware.ts'], { encoding: 'utf8' });
for (const file of sources.split(/\r?\n/).filter(path => /\.(mjs|tsx?)$/.test(path))) {
  for (const [, name] of read(file).matchAll(/\bprocess\.env\.([A-Z][A-Z0-9_]*)/g)) {
    if (!settings.has(name) && !runtimeOnly.has(name)) errors.push(file + ' reads ' + name + ' missing from .env.example');
  }
}

// Compare the guide to actual App Router endpoints filtered through Beta's runtime policy.
const routeFiles = execFileSync('git', ['ls-files', 'app/api'], { encoding: 'utf8' }).split(/\r?\n/);
const allowed = routeFiles.filter(name => name.endsWith('/route.ts')).map(name => name.slice(3, -9))
  .filter(isBetaPathAllowed).sort();
const match = read('docs/BETA-DEVELOPMENT.md').match(/<!-- beta-api:start -->([\s\S]*?)<!-- beta-api:end -->/);
const documented = [...(match?.[1] ?? '').matchAll(/`(\/api\/[^`]+)`/g)].map(entry => entry[1]).sort();
if (!match || JSON.stringify(allowed) !== JSON.stringify(documented)) {
  errors.push('Update the Beta API list in docs/BETA-DEVELOPMENT.md. Current routes: ' + allowed.join(', '));
}

if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
  const { pull_request: pr } = JSON.parse(read(process.env.GITHUB_EVENT_PATH!));
  if (!/^[0-9a-f]{40}$/.test(pr.base.sha)) throw new Error('Missing PR base SHA');
  const changed = execFileSync('git', ['diff', '--name-only', '-z', pr.base.sha, 'HEAD'], { encoding: 'utf8' })
    .split('\0').filter(Boolean);
  const contracts: [RegExp, string[]][] = [
    [/^(package\.json$|scripts\/|tests\/integration\/)/, ['docs/TESTING.md', 'docs/LOCAL-DEVELOPMENT.md', 'AGENTS.md']],
    [/^(middleware\.ts$|app\/api\/|lib\/(beta-|kiosk-auth))/, ['docs/BETA-DEVELOPMENT.md', 'README.md']],
    [/^(\.github\/|vercel.*\.json$)/, ['docs/COLLABORATION.md', 'docs/TESTING.md', 'docs/DOTTY-PR-APPROVAL.md']],
    [/^supabase\/migrations\//, ['docs/LOCAL-DEVELOPMENT.md', 'docs/BETA-DEVELOPMENT.md', 'AGENTS.md']],
    [/^(components\/|app\/.*page\.tsx$|lib\/(domain|cart|time|family|pickups)\.ts$)/, ['README.md', 'AGENTS.md']],
  ];
  // A PR can explain an unchanged guide instead of editing it for an internal change.
  const explanation = /^Context unchanged: (.+)$/im.exec(pr.body ?? '')?.[1].trim();
  for (const [contract, owners] of contracts) {
    if (changed.some(file => contract.test(file)) && !owners.some(guide => changed.includes(guide)) && !explanation) {
      errors.push('Review ' + owners.join(' or ') + '. Update the relevant guide or add “Context unchanged: <reason>” to the PR description.');
    }
  }
}
if (errors.length) throw new Error('\n' + errors.join('\n'));
console.log('Project guide commands, local links, Beta API contract and applicable PR context review passed.');
