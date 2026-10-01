// Stage dashboard data into public/data/ for local dev and builds.
// Source order: data/dashboard.json (built locally by `pnpm build:data`) -> data/sample/dashboard.json.
// CI stages live data itself and sets STAGED_DATA=1 so this script leaves it untouched.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pkgRoot, '..', '..');
const target = join(pkgRoot, 'public', 'data', 'dashboard.json');

if (process.env.STAGED_DATA === '1' && existsSync(target)) {
  console.log('STAGED_DATA=1: keeping the pre-staged public/data/dashboard.json');
  process.exit(0);
}

const live = join(repoRoot, 'data', 'dashboard.json');
const sample = join(repoRoot, 'data', 'sample', 'dashboard.json');
const source = existsSync(live) ? live : sample;

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`Staged ${source.replace(repoRoot, '.')} -> public/data/dashboard.json`);
