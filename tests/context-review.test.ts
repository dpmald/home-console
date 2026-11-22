import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

test('guide checks allow a reasoned internal change and still reject verifiable drift', t => {
  const root = mkdtempSync(join(tmpdir(), 'kitchen-guides-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name: string, contents: string) => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), contents);
  };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  };
  git('init', '-q');
  for (const doc of ['README.md', 'AGENTS.md', 'docs/COLLABORATION.md', 'docs/TESTING.md', 'docs/LOCAL-DEVELOPMENT.md',
    'docs/DOTTY-PR-APPROVAL.md']) put(doc, '# Guide');
  put('docs/BETA-DEVELOPMENT.md', '<!-- beta-api:start -->\n`/api/kiosk`\n<!-- beta-api:end -->');
  put('app/api/kiosk/route.ts', '');
  put('package.json', '{"scripts":{}}');
  put('.env.example', '');
  commit();
  const base = git('rev-parse', 'HEAD');
  put('components/Example.tsx', 'export const label = "Sunday";');
  commit();
  const require = createRequire(resolve('package.json'));
  const args = ['--import', pathToFileURL(require.resolve('tsx')).href, resolve('scripts/check-context.ts')];
  const check = (body: string) => {
    put('event.json', JSON.stringify({ pull_request: { base: { sha: base }, body } }));
    return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8',
      env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: join(root, 'event.json') } });
  };
  assert.match(check('').stderr, /Review README.md or AGENTS.md/);
  const reason = 'Context unchanged: this refactor preserves the displayed text.';
  const valid = check(reason);
  assert.equal(valid.status, 0, valid.stderr);
  put('AGENTS.md', 'Run `npm run obsolete` and read [setup](missing.md).');
  put('docs/BETA-DEVELOPMENT.md', '<!-- beta-api:start --><!-- beta-api:end -->');
  put('components/Example.tsx', 'export const endpoint = process.env.NEW_SETTING;');
  const stale = check(reason);
  assert.notEqual(stale.status, 0);
  for (const problem of ['missing npm script obsolete', 'missing file missing.md', 'Update the Beta API list',
    'NEW_SETTING missing from .env.example']) assert.ok(stale.stderr.includes(problem), problem);
});
