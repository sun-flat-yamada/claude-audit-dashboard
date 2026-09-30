// Stage dashboard data into public/data/ for local dev and builds.
// CI (deploy-pages.yml) stages live data first; this script never overwrites it.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pkgRoot, '..', '..');
const target = join(pkgRoot, 'public', 'data', 'dashboard.json');

if (existsSync(target)) process.exit(0);

const live = join(repoRoot, 'data', 'dashboard.json');
const sample = join(repoRoot, 'data', 'sample', 'dashboard.json');
const source = existsSync(live) ? live : sample;

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`Staged ${source.replace(repoRoot, '.')} -> public/data/dashboard.json`);
