#!/usr/bin/env node

/**
 * worktree-manage — Sibling git worktree lifecycle helper
 *
 * Usage:
 *   pnpm worktree:add <branch> [base]   # create ../claude-audit-dashboard-worktrees/<branch-slug>
 *   pnpm worktree:list                  # list active worktrees
 *   pnpm worktree:clean <branch>        # remove the worktree and delete the merged local branch
 *
 * See CONTRIBUTING.md and .agents/rules/development-workflow.md.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WORKTREE_ROOT = resolve(ROOT, '..', `${basename(ROOT)}-worktrees`);

function git(args: string[], opts: { cwd?: string } = {}): string {
  return execFileSync('git', args, {
    cwd: opts.cwd ?? ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

function slug(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '-');
}

function usage(): never {
  console.error('Usage: worktree-manage <add|list|clean> [branch] [base]');
  process.exit(2);
}

const [command, branch, base = 'origin/main'] = process.argv.slice(2);

switch (command) {
  case 'add': {
    if (!branch) usage();
    const dir = join(WORKTREE_ROOT, slug(branch));
    if (existsSync(dir)) {
      console.error(`Worktree already exists: ${dir}`);
      process.exit(1);
    }
    const remote = base.includes('/') ? base.split('/')[0]! : 'origin';
    const ref = base.includes('/') ? base.slice(remote.length + 1) : base;
    try {
      git(['fetch', remote, ref]);
    } catch {
      console.warn(`⚠️  Could not fetch ${base}; using local ref.`);
    }
    git(['worktree', 'add', dir, '-b', branch, base]);
    console.log(`✅ Worktree created: ${dir}`);
    console.log(`   Next: cd "${dir}" && pnpm install`);
    break;
  }
  case 'list': {
    console.log(git(['worktree', 'list']));
    break;
  }
  case 'clean': {
    if (!branch) usage();
    const dir = join(WORKTREE_ROOT, slug(branch));
    if (existsSync(dir)) {
      git(['worktree', 'remove', dir]);
      console.log(`🧹 Removed worktree: ${dir}`);
    }
    git(['worktree', 'prune']);
    try {
      git(['branch', '-d', branch]);
      console.log(`🧹 Deleted local branch: ${branch}`);
    } catch {
      console.warn(`⚠️  Branch ${branch} not deleted (not merged or already gone).`);
    }
    break;
  }
  default:
    usage();
}
