// Export only application sources. Project links and device secrets stay outside the repository.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = mkdtempSync(path.join(tmpdir(), 'home-console-beta-'));
const paths = execFileSync('git', ['ls-files', '-z', '--', 'app', 'components', 'lib', 'public'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean);
for (const file of [...paths, 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'middleware.ts', 'next-env.d.ts']) {
  if (!existsSync(path.join(root, file))) continue;
  mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
  copyFileSync(path.join(root, file), path.join(stage, file));
}
copyFileSync(path.join(root, 'vercel.beta.json'), path.join(stage, 'vercel.json'));
writeFileSync(path.join(stage, '.vercelignore'), '.env*\n.git\n.vercel\nnode_modules\n.next\n');
console.log(stage);
