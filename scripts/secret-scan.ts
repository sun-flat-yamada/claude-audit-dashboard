#!/usr/bin/env node

/**
 * secret-scan — Scans repository files for potential secrets
 *
 * Patterns checked:
 * - Anthropic API keys (sk-ant-admin, sk-ant-api)
 * - GitHub tokens (ghp_, gho_, github_pat_)
 * - Slack/Discord webhooks
 * - Cloud provider keys (AKIA, AIza, sk-)
 * - Private key headers
 *
 * Exit code 1 if any non-placeholder match is found.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname, relative, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
let findings = 0;

const PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'Anthropic Admin Key', pattern: /sk-ant-admin[A-Za-z0-9_-]{20,}/ },
  { name: 'Anthropic API Key', pattern: /sk-ant-api[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub PAT (classic)', pattern: /ghp_[A-Za-z0-9]{36,}/ },
  { name: 'GitHub PAT (fine-grained)', pattern: /github_pat_[A-Za-z0-9_]{30,}/ },
  { name: 'GitHub OAuth Token', pattern: /gho_[A-Za-z0-9]{36,}/ },
  { name: 'Slack Webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/ },
  { name: 'Discord Webhook', pattern: /https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/ },
  { name: 'AWS Access Key', pattern: /AKIA[A-Z0-9]{16}/ },
  { name: 'Google API Key', pattern: /AIza[A-Za-z0-9_-]{35}/ },
  { name: 'OpenAI Key', pattern: /sk-[A-Za-z0-9]{48,}/ },
  { name: 'Private Key Header', pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/ },
];

/**
 * Documented, obviously fake placeholders (e.g. `sk-ant-admin-mock0000…`,
 * `T00000000/B00000000/mock…`) are allowed so that guidance docs and sample
 * data can show the expected shape of a credential without tripping the scan.
 */
function isPlaceholder(value: string): boolean {
  return /mock|example|x{8,}|0{8,}/i.test(value);
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'coverage', '.next', '__pycache__', '.venv',
  '.pnpm-store',
]);

const IGNORE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2',
  '.ttf', '.eot', '.mp4', '.webm', '.zip', '.gz', '.tar', '.lock',
  '.tsbuildinfo',
]);

function scan(dir: string, depth = 0): void {
  if (depth > 8) return;
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        scan(full, depth + 1);
      } else if (stat.isFile()) {
        if (IGNORE_EXTENSIONS.has(extname(entry))) continue;
        if (stat.size > 2_000_000) continue; // Skip large files
        try {
          const content = readFileSync(full, 'utf-8');
          const relPath = relative(ROOT, full).split(sep).join('/');
          for (const { name, pattern } of PATTERNS) {
            for (const match of content.matchAll(new RegExp(pattern.source, 'g'))) {
              if (isPlaceholder(match[0])) continue;
              const line = content.slice(0, match.index).split('\n').length;
              console.error(`🔴 FOUND: ${name} in ${relPath}:${line}`);
              findings++;
            }
          }
        } catch {
          // Skip binary/unreadable files
        }
      }
    }
  } catch {
    // Skip inaccessible directories
  }
}

console.log('🔒 Secret Scanner');
console.log('═'.repeat(40));
console.log(`Scanning: ${ROOT}\n`);

scan(ROOT);

if (findings > 0) {
  console.error(`\n💥 FAILED: ${findings} potential secret(s) found`);
  process.exit(1);
} else {
  console.log('\n✅ CLEAN: No secrets detected');
  process.exit(0);
}
