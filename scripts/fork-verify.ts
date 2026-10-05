#!/usr/bin/env node

/**
 * fork:verify — Ensures the main branch is fork-safe
 *
 * Checks:
 * 1. No live audit data files are tracked on the code branch
 * 2. Sample data matches the published dashboard and detail contracts, comes from the synthetic
 *    demo tenant and contains no real-looking e-mail addresses or unmasked identifiers
 * 3. No secrets in tracked files; sanitized tenant fixtures use example.com / 192.0.2.0/24 only
 * 4. .gitignore properly configured
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkDetailBundle, dashboardViewSchema } from '../packages/core/src/contracts/index.js';

const ROOT = resolve(import.meta.dirname, '..');
let errors = 0;
let warnings = 0;

function fail(msg: string): void {
  console.error(`❌ FAIL: ${msg}`);
  errors++;
}

function warn(msg: string): void {
  console.warn(`⚠️  WARN: ${msg}`);
  warnings++;
}

function listTrackedFiles(): string[] | null {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' });
    return out.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

function pass(msg: string): void {
  console.log(`✅ PASS: ${msg}`);
}

console.log('🔍 Fork Safety Verification');
console.log('═'.repeat(50));

// --- Check 1: No live data on main branch ---
console.log('\n📁 Check 1: Live data isolation');

const forbiddenPaths = [
  'data/snapshots',
  'data/reports',
  'data/dashboard.json',
  'data/state.json',
  'data/archive',
  'data/raw',
  'data/fixture',
  'data/detail',
  'data/alerts',
];

const trackedFiles = listTrackedFiles();
if (trackedFiles) {
  // Inside a git checkout: only files that are actually tracked matter.
  // Local, gitignored runtime data (e.g. after `pnpm collect`) is fine.
  for (const rel of forbiddenPaths) {
    const hits = trackedFiles.filter(
      (f) => (f === rel || f.startsWith(`${rel}/`)) && !f.endsWith('.gitkeep'),
    );
    if (hits.length > 0) fail(`Live data tracked by git: ${hits.join(', ')}`);
  }
} else {
  for (const rel of forbiddenPaths) {
    const abs = join(ROOT, rel);
    if (existsSync(abs)) {
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        const files = readdirSync(abs).filter((f) => f !== '.gitkeep');
        if (files.length > 0) {
          fail(`Live data found in ${rel}/: ${files.join(', ')}`);
        }
      } else {
        fail(`Live data file found: ${rel}`);
      }
    }
  }
}

if (errors === 0) {
  pass('No live data files on main branch');
}

// --- Check 1b: dashboard tests never read live data ---
console.log('\n🧫 Check 1b: Dashboard test data sources');

const LIVE_SOURCE = /DASHBOARD_DATA_SOURCE[^\n]*live/;
const LIVE_PATH = /['"]data['"]\s*,\s*['"]dashboard\.json['"]/;

function listTestFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listTestFiles(full);
    return /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name) ? [full] : [];
  });
}

function checkDashboardTestSources(): void {
  const before = errors;
  const dashboard = join(ROOT, 'packages', 'dashboard');
  // scripts/__tests__ exercises stage-data.mjs itself (with temp dirs), so it may name `live`.
  const files = [
    ...listTestFiles(join(dashboard, 'src')),
    ...listTestFiles(join(dashboard, 'e2e')),
  ];
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    if (LIVE_SOURCE.test(content) || LIVE_PATH.test(content))
      fail(`${file.slice(ROOT.length + 1)} reads live data: tests and E2E use sample or fixtures`);
  }
  const pkg = readFileSync(join(dashboard, 'package.json'), 'utf-8');
  if (/"(test|e2e)[^"]*":\s*"[^"]*DASHBOARD_DATA_SOURCE=live/.test(pkg))
    fail('packages/dashboard/package.json test scripts must not use DASHBOARD_DATA_SOURCE=live');
  if (errors === before) pass(`${files.length} dashboard test file(s) use sample or fixtures only`);
}

checkDashboardTestSources();

// --- Check 2: Sample data validity ---
console.log('\n📋 Check 2: Sample data presence and validity');

const sampleDir = join(ROOT, 'data', 'sample');
const sampleFile = join(sampleDir, 'dashboard.json');
const EMAIL = /[A-Za-z0-9._%+*-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;
const SAFE_EMAIL_DOMAIN = /@(([A-Za-z0-9-]+\.)*example\.(com|org|net)|anthropic\.com)$/i;

function checkSampleDashboard(): void {
  if (!existsSync(sampleFile)) return fail('data/sample/dashboard.json is missing');
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(sampleFile, 'utf-8'));
  } catch {
    return fail('data/sample/dashboard.json is not valid JSON');
  }
  const parsed = dashboardViewSchema.safeParse(data);
  if (!parsed.success)
    return fail(
      `data/sample/dashboard.json does not match the dashboard contract: ${parsed.error.message}`,
    );
  if (parsed.data.source !== 'demo')
    return fail('data/sample/dashboard.json must be generated from the demo tenant (`pnpm demo`)');
  pass('Sample dashboard data matches the published contract (demo source)');
}

/** Relative paths (forward slashes) of every file below `dir`. */
function listFilesRecursive(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFilesRecursive(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

function checkSampleDetail(): void {
  const detailDir = join(sampleDir, 'detail');
  if (!existsSync(detailDir)) return fail('data/sample/detail/ is missing (run `pnpm demo`)');
  const files = Object.fromEntries(
    listFilesRecursive(detailDir).map((name) => [
      `detail/${name}`,
      readFileSync(join(detailDir, name), 'utf-8'),
    ]),
  );
  const problems = checkDetailBundle(files, { requireDemo: true });
  for (const problem of problems) fail(`data/sample/${problem}`);
  if (problems.length === 0)
    pass(`${Object.keys(files).length} sample detail files match the detail contract (masked)`);
}

function checkSampleEmails(): void {
  const before = errors;
  for (const name of listFilesRecursive(sampleDir)) {
    const content = readFileSync(join(sampleDir, name), 'utf-8');
    const real = [...content.matchAll(EMAIL)]
      .map((m) => m[0])
      .filter((e) => !SAFE_EMAIL_DOMAIN.test(e));
    if (real.length > 0)
      fail(
        `data/sample/${name} contains non-example e-mail addresses: ${[...new Set(real)].slice(0, 3).join(', ')}`,
      );
  }
  if (errors === before) pass('Sample data uses example.* e-mail domains only');
}

checkSampleDashboard();
checkSampleDetail();
if (existsSync(sampleDir)) checkSampleEmails();

// --- Check 3: Secret scanning ---
console.log('\n🔒 Check 3: Secret scanning');

const SECRET_PATTERNS = [
  { name: 'Anthropic Admin Key', pattern: /sk-ant-admin[A-Za-z0-9_-]{20,}/ },
  { name: 'Anthropic API Key', pattern: /sk-ant-api[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub Token', pattern: /gh[ps]_[A-Za-z0-9_]{30,}/ },
  { name: 'GitHub PAT', pattern: /github_pat_[A-Za-z0-9_]{30,}/ },
  { name: 'Slack Webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/ },
  {
    name: 'Discord Webhook',
    pattern: /https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/,
  },
];

function scanFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const { name, pattern } of SECRET_PATTERNS) {
      const matches = [...content.matchAll(new RegExp(pattern.source, 'g'))];
      if (matches.some((m) => !/mock|example|x{8,}|0{8,}/i.test(m[0]))) {
        fail(`Potential ${name} found in ${filePath}`);
      }
    }
  } catch {
    // Skip binary files
  }
}

function scanDirectory(dir: string, depth = 0): void {
  if (depth > 5) return;
  const ignore = ['node_modules', '.git', 'dist', 'coverage', '.tsbuildinfo'];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (ignore.includes(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        scanDirectory(full, depth + 1);
      } else if (stat.isFile() && stat.size < 1_000_000) {
        scanFile(full);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
}

const errorsBeforeScan = errors;

scanDirectory(ROOT);
if (errors === errorsBeforeScan) {
  pass('No secrets detected in tracked files');
}

// --- Check 3b: tenant-shape fixtures (sanitized API responses) ---
console.log('\n🧪 Check 3b: Tenant fixtures');

const FIXTURE_DIR = join(
  ROOT,
  'packages/collector/src/adapters/anthropic/__tests__/fixtures/tenant',
);
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

function checkTenantFixtures(): void {
  const before = errors;
  const names = existsSync(FIXTURE_DIR)
    ? readdirSync(FIXTURE_DIR).filter((n) => n.endsWith('.json'))
    : [];
  if (names.length === 0) return fail('Tenant fixtures are missing: fixtures/tenant/*.json');
  for (const name of names) {
    const content = readFileSync(join(FIXTURE_DIR, name), 'utf-8');
    const emails = [...content.matchAll(EMAIL)]
      .map((m) => m[0])
      .filter((e) => !SAFE_EMAIL_DOMAIN.test(e));
    if (emails.length > 0)
      fail(
        `Tenant fixture ${name} contains non-example e-mail addresses: ${[...new Set(emails)].slice(0, 3).join(', ')}`,
      );
    const ips = [...content.matchAll(IPV4)]
      .map((m) => m[0])
      .filter((ip) => !ip.startsWith('192.0.2.'));
    if (ips.length > 0)
      fail(
        `Tenant fixture ${name} contains IP addresses outside 192.0.2.0/24: ${[...new Set(ips)].slice(0, 3).join(', ')}`,
      );
    for (const { name: kind, pattern } of SECRET_PATTERNS) {
      if (pattern.test(content)) fail(`Tenant fixture ${name} contains a ${kind}`);
    }
  }
  if (errors === before)
    pass(`${names.length} tenant fixtures use example.com and 192.0.2.0/24 only`);
}

checkTenantFixtures();

// --- Check 4: .gitignore configuration ---
console.log('\n📝 Check 4: .gitignore configuration');

const errorsBeforeGitignore = errors;
const gitignorePath = join(ROOT, '.gitignore');
if (!existsSync(gitignorePath)) {
  fail('.gitignore is missing');
} else {
  const gitignore = readFileSync(gitignorePath, 'utf-8');
  const requiredPatterns = ['.env', 'node_modules', 'dist', 'data/raw'];
  for (const pattern of requiredPatterns) {
    if (!gitignore.includes(pattern)) {
      fail(`.gitignore is missing pattern: ${pattern}`);
    }
  }
  if (errors === errorsBeforeGitignore) {
    pass('.gitignore is properly configured');
  }
}

// --- Check 5: .env file not tracked ---
console.log('\n🔐 Check 5: Environment file safety');

const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  warn('.env file exists locally (ensure it is not committed)');
} else {
  pass('.env file not present (correct for main branch)');
}

const envExampleFile = join(ROOT, '.env.example');
if (!existsSync(envExampleFile)) {
  warn('.env.example is missing (recommended for setup guidance)');
} else {
  // Check .env.example doesn't contain real values
  const content = readFileSync(envExampleFile, 'utf-8');
  const lines = content.split('\n').filter((l) => l.includes('=') && !l.startsWith('#'));
  for (const line of lines) {
    const [, value] = line.split('=', 2);
    if (
      value &&
      value.trim().length > 20 &&
      !value.includes('example') &&
      !value.includes('mock')
    ) {
      warn(`Suspicious value in .env.example: ${line.split('=')[0]}`);
    }
  }
  pass('.env.example is present and clean');
}

// --- Summary ---
console.log('\n' + '═'.repeat(50));
if (errors > 0) {
  console.error(`\n💥 Fork verification FAILED: ${errors} error(s), ${warnings} warning(s)`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`\n⚠️  Fork verification PASSED with ${warnings} warning(s)`);
  process.exit(0);
} else {
  console.log('\n🎉 Fork verification PASSED — repository is fork-safe');
  process.exit(0);
}
