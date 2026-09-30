#!/usr/bin/env node

/**
 * fork:verify — Ensures the main branch is fork-safe
 *
 * Checks:
 * 1. No live audit data files are tracked on the code branch
 * 2. Sample data is valid and present
 * 3. No secrets in tracked files
 * 4. .gitignore properly configured
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

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

// --- Check 2: Sample data validity ---
console.log('\n📋 Check 2: Sample data presence and validity');

const sampleFile = join(ROOT, 'data', 'sample', 'dashboard.json');
if (!existsSync(sampleFile)) {
  fail('data/sample/dashboard.json is missing');
} else {
  try {
    const content = readFileSync(sampleFile, 'utf-8');
    const data = JSON.parse(content);
    if (!data.last_updated || !data.organization || !data.compliance || !data.usage) {
      fail('data/sample/dashboard.json is missing required fields');
    } else {
      pass('Sample dashboard data is valid');
    }
  } catch {
    fail('data/sample/dashboard.json is not valid JSON');
  }
}

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

// --- Check 4: .gitignore configuration ---
console.log('\n📝 Check 4: .gitignore configuration');

const errorsBeforeGitignore = errors;
const gitignorePath = join(ROOT, '.gitignore');
if (!existsSync(gitignorePath)) {
  fail('.gitignore is missing');
} else {
  const gitignore = readFileSync(gitignorePath, 'utf-8');
  const requiredPatterns = ['.env', 'node_modules', 'dist'];
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
