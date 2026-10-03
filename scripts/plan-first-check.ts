/**
 * Plan-first gate for the change-dev lifecycle.
 *
 * `implementation_plan.md` must be committed BEFORE the implementation: the commit that adds
 * `.devs/changes/<dir>/implementation_plan.md` has to come strictly before the first commit that
 * touches implementation files. Documentation-only (`*.md`, `docs/`) and plan-only branches are exempt.
 *
 *   pnpm change-dev:plan-check [-- --base origin/main] [--head HEAD]
 *
 * `change-dev:finish` runs the same check before it merges.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export interface CommitChange {
  sha: string;
  /** `git log --name-status` entries (status letter + path), `--no-renames` */
  files: Array<{ status: string; path: string }>;
}

export interface PlanFirstResult {
  ok: boolean;
  /** true when the branch has no implementation files, so no plan is required */
  exempt: boolean;
  message: string;
}

const PLAN_PATH = /^\.devs\/changes\/[^/]+\/implementation_plan\.md$/;

/** Implementation = anything that is not a change artifact, a spec/doc, or any Markdown file */
export function isImplementationFile(file: string): boolean {
  if (file.startsWith('.devs/') || file.startsWith('docs/')) return false;
  return !file.toLowerCase().endsWith('.md');
}

export function isPlanFile(file: string): boolean {
  return PLAN_PATH.test(file);
}

/** commits: oldest first (the order of `git log --reverse base..head`) */
export function evaluatePlanFirst(commits: CommitChange[]): PlanFirstResult {
  const firstImpl = commits.findIndex((c) => c.files.some((f) => isImplementationFile(f.path)));
  if (firstImpl === -1) {
    return {
      ok: true,
      exempt: true,
      message: 'No implementation files changed: a plan is not required.',
    };
  }
  const planAt = commits.findIndex((c) =>
    c.files.some((f) => f.status === 'A' && isPlanFile(f.path)),
  );
  if (planAt === -1) {
    return {
      ok: false,
      exempt: false,
      message:
        'Implementation files changed but no `.devs/changes/<dir>/implementation_plan.md` was added. ' +
        'Write the plan and commit it alone BEFORE the implementation (change-dev Phase 2).',
    };
  }
  if (planAt >= firstImpl) {
    const where = planAt === firstImpl ? 'in the same commit as' : 'after';
    return {
      ok: false,
      exempt: false,
      message:
        `implementation_plan.md was committed ${where} the first implementation commit (${commits[firstImpl].sha.slice(0, 7)}). ` +
        'The plan must be committed first, on its own, before any implementation file is touched.',
    };
  }
  return {
    ok: true,
    exempt: false,
    message: `Plan-first OK: plan in ${commits[planAt].sha.slice(0, 7)}, first implementation in ${commits[firstImpl].sha.slice(0, 7)}.`,
  };
}

export function parseGitLog(output: string): CommitChange[] {
  const commits: CommitChange[] = [];
  for (const line of output.split('\n')) {
    if (line.startsWith('COMMIT ')) {
      commits.push({ sha: line.slice('COMMIT '.length).trim(), files: [] });
    } else if (line.trim() && commits.length > 0) {
      const [status, ...rest] = line.split('\t');
      if (status && rest.length > 0)
        commits[commits.length - 1].files.push({ status: status[0], path: rest[rest.length - 1] });
    }
  }
  return commits;
}

export function readCommits(repoRoot: string, base: string, head: string): CommitChange[] {
  const out = execFileSync(
    'git',
    [
      'log',
      '--reverse',
      '--no-merges',
      '--no-renames',
      '--name-status',
      '--format=COMMIT %H',
      `${base}..${head}`,
    ],
    { cwd: repoRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  return parseGitLog(out);
}

export function checkPlanFirst(repoRoot: string, base: string, head: string): PlanFirstResult {
  return evaluatePlanFirst(readCommits(repoRoot, base, head));
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main(): void {
  const repoRoot = process.cwd();
  const base = arg('--base', 'origin/main');
  const head = arg('--head', 'HEAD');
  let result: PlanFirstResult;
  try {
    result = checkPlanFirst(repoRoot, base, head);
  } catch (e) {
    console.error(
      `[plan-first] could not read git history for ${base}..${head}: ${(e as Error).message.split('\n')[0]}`,
    );
    process.exit(1);
  }
  if (result.ok) {
    console.log(`[plan-first] ✅ ${result.message}`);
    return;
  }
  console.error(`[plan-first] ❌ ${result.message}`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
