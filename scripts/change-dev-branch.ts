/**
 * Branch naming for the change-dev lifecycle (`.agents/rules/git-rules-commit.md`).
 *
 * A change-dev branch is named after the change: `<type>/<issue>-<slug>` (e.g. `feat/42-cost-center-export`),
 * or `<type>/<slug>` when there is no Issue. Claude Code cloud sessions start on a platform-assigned name
 * (`claude/<adjective>-<name>-<id>`, `ccr-<hex>-<id>`) that says nothing about the change; change-dev renames
 * it before the first push.
 *
 *   pnpm change-dev:branch name   <type> <issue|-> <title...>   # or --type / --issue / --title / --slug
 *   pnpm change-dev:branch name   --issue 42                    # type and title from the Issue title
 *   pnpm change-dev:branch check  [branch]                      # default: the current branch
 *   pnpm change-dev:branch rename <same arguments as name> [--dry-run]
 *
 * `change-dev:finish` and the `branch-name` workflow run the same validation.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const BRANCH_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;
export type BranchType = (typeof BRANCH_TYPES)[number];

export const MAX_SLUG_LENGTH = 40;
export const MAX_BRANCH_LENGTH = 60;

/** Long-lived or bot-owned branches that are not change-dev branches */
const EXEMPT = [/^main$/, /^data\/audit$/, /^fork\/custom$/, /^dependabot\//];

/** Names the Claude Code cloud platform assigns to a session branch */
const CLOUD_DEFAULT = [/^claude\/[a-z]+-[a-z]+-[a-z0-9]{4,}$/i, /^ccr-[0-9a-f]{6,}-[a-z0-9]{4,}$/i];

const BRANCH_PATTERN = new RegExp(
  `^(${BRANCH_TYPES.join('|')})/(?:([1-9][0-9]*)-)?([a-z0-9]+(?:-[a-z0-9]+)*)$`,
);

/** Words dropped from a title slug: they make the name longer without saying more */
const STOP_WORDS = new Set(['a', 'an', 'the']);

export function isBranchType(value: string): value is BranchType {
  return (BRANCH_TYPES as readonly string[]).includes(value);
}

export function isCloudDefaultBranch(branch: string): boolean {
  return CLOUD_DEFAULT.some((re) => re.test(branch));
}

/**
 * Title → kebab-case ASCII slug, cut at a word boundary to `max` characters.
 * Returns '' when nothing ASCII is left (e.g. a Japanese title): pass `--slug` then.
 */
export function slugify(title: string, max: number = MAX_SLUG_LENGTH): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w));
  let slug = '';
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > max) break;
    slug = next;
  }
  return slug || (words[0] ?? '').slice(0, max);
}

/** Split a Conventional Commits title (`feat(scope): text`) into its type and text */
export function parseConventionalTitle(title: string): { type: BranchType | null; text: string } {
  const m = title.match(/^\s*([a-z]+)(?:\([^)]*\))?!?:\s*(.*)$/);
  if (m && isBranchType(m[1])) return { type: m[1], text: m[2] };
  // Work-Unit Issues are titled `[<task-id>] <title>`
  return { type: null, text: title.replace(/^\s*\[[^\]]*\]\s*/, '') };
}

export interface BranchSpec {
  type: string;
  issue?: number | null;
  /** used as is when given; otherwise derived from `title` */
  slug?: string | undefined;
  title?: string | undefined;
}

export function buildBranchName(spec: BranchSpec): string {
  if (!isBranchType(spec.type)) {
    throw new Error(`unknown type "${spec.type}" (use one of: ${BRANCH_TYPES.join(', ')})`);
  }
  const slug = spec.slug ? spec.slug.toLowerCase() : slugify(spec.title ?? '');
  if (!slug)
    throw new Error(
      'the title has no ASCII words to build a slug from: pass --slug <kebab-case-slug>',
    );
  const name = spec.issue ? `${spec.type}/${spec.issue}-${slug}` : `${spec.type}/${slug}`;
  const result = validateBranchName(name);
  if (result.status !== 'ok')
    throw new Error(`"${name}" is not a valid branch name: ${result.reasons.join('; ')}`);
  return name;
}

export interface BranchValidation {
  status: 'ok' | 'exempt' | 'invalid';
  reasons: string[];
}

export function validateBranchName(branch: string): BranchValidation {
  if (EXEMPT.some((re) => re.test(branch))) return { status: 'exempt', reasons: [] };
  if (isCloudDefaultBranch(branch)) {
    return {
      status: 'invalid',
      reasons: [
        `"${branch}" is the name the Claude Code cloud platform assigned to the session and does not describe the change; ` +
          'rename it with `pnpm change-dev:branch rename <type> <issue> "<title>"` before the first push',
      ],
    };
  }
  const reasons: string[] = [];
  const m = branch.match(BRANCH_PATTERN);
  if (!m) {
    reasons.push(
      `"${branch}" does not match <type>/<issue>-<slug> or <type>/<slug> ` +
        `(type: ${BRANCH_TYPES.join('|')}; slug: lowercase a-z, 0-9 and single hyphens)`,
    );
  } else {
    const slug = m[3];
    if (slug.length > MAX_SLUG_LENGTH)
      reasons.push(`slug is ${slug.length} characters (max ${MAX_SLUG_LENGTH})`);
    if (slug.length < 3 || /^[0-9-]+$/.test(slug))
      reasons.push('slug must describe the change in words');
  }
  if (branch.length > MAX_BRANCH_LENGTH)
    reasons.push(`name is ${branch.length} characters (max ${MAX_BRANCH_LENGTH})`);
  return reasons.length ? { status: 'invalid', reasons } : { status: 'ok', reasons: [] };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function gitOk(args: string[]): boolean {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

function currentBranch(): string {
  return git(['rev-parse', '--abbrev-ref', 'HEAD']);
}

function remoteBranchSha(branch: string): string | null {
  const out = git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
  return out ? out.split(/\s+/)[0] : null;
}

function repoSlug(): string {
  const url = git(['remote', 'get-url', 'origin']);
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`origin is not a github.com repository: ${url}`);
  return `${m[1]}/${m[2]}`;
}

/** REST only: the cloud GitHub proxy rejects GraphQL */
function issueTitle(issue: number): string {
  const out = execFileSync('gh', ['api', `repos/${repoSlug()}/issues/${issue}`, '--jq', '.title'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return out.trim();
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function positionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (['--type', '--issue', '--title', '--slug'].includes(args[i])) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function parseIssue(raw: string | undefined): number | null {
  if (raw === undefined || raw === '-' || raw === '') return null;
  const n = Number(raw.replace(/^#/, ''));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid issue number "${raw}"`);
  return n;
}

/** Resolve the name from `<type> <issue|-> <title...>` or the --type / --issue / --title / --slug options */
export function specFromArgs(
  args: string[],
  fetchTitle: (issue: number) => string = issueTitle,
): BranchSpec {
  const pos = positionals(args);
  let type = option(args, '--type') ?? pos[0];
  const issue = parseIssue(option(args, '--issue') ?? pos[1]);
  const slug = option(args, '--slug');
  let title = option(args, '--title') ?? (pos.length > 2 ? pos.slice(2).join(' ') : undefined);
  if (!title && !slug && issue) title = fetchTitle(issue);
  if (title) {
    const parsed = parseConventionalTitle(title);
    if (!type && parsed.type) type = parsed.type;
    title = parsed.text;
  }
  if (!type)
    throw new Error(
      'pass the change type (feat, fix, docs, ...) as the first argument or with --type',
    );
  return { type, issue, slug, title };
}

function printUsage(): void {
  console.error(`Usage:
  pnpm change-dev:branch name   <type> <issue|-> <title...>
  pnpm change-dev:branch name   --issue <n> [--type <type>] [--slug <slug>]
  pnpm change-dev:branch check  [branch]
  pnpm change-dev:branch rename <same arguments as name> [--dry-run]`);
}

function runCheck(branch: string): number {
  const r = validateBranchName(branch);
  if (r.status === 'invalid') {
    for (const reason of r.reasons) console.error(`[branch-name] ❌ ${reason}`);
    return 1;
  }
  console.log(
    `[branch-name] ✅ ${branch}${r.status === 'exempt' ? ' (long-lived / bot branch, not checked)' : ''}`,
  );
  return 0;
}

/**
 * Rename the current branch to the change-dev name. Allowed only while the current branch carries no pushed
 * work of its own: it is absent from origin, or its remote tip is already in origin/main. Never renames `main`
 * and never reuses a name that exists locally or on origin.
 */
function runRename(args: string[]): number {
  const from = currentBranch();
  const to = buildBranchName(specFromArgs(args));
  if (from === to) {
    console.log(`[branch-name] ✅ already on ${to}`);
    return 0;
  }
  if (from === 'HEAD' || validateBranchName(from).status === 'exempt') {
    console.error(
      `[branch-name] ❌ refusing to rename "${from}": create the change branch from origin/main instead`,
    );
    return 1;
  }
  if (gitOk(['rev-parse', '--verify', '--quiet', `refs/heads/${to}`]) || remoteBranchSha(to)) {
    console.error(`[branch-name] ❌ "${to}" already exists: pick another slug (--slug)`);
    return 1;
  }
  const pushed = remoteBranchSha(from);
  if (pushed) {
    gitOk(['fetch', '--quiet', 'origin', 'main', from]);
    if (!gitOk(['merge-base', '--is-ancestor', pushed, 'origin/main'])) {
      console.error(
        `[branch-name] ❌ "${from}" already has pushed work on origin: keep it (an open PR depends on the name) or move the work to a new branch yourself`,
      );
      return 1;
    }
  }
  if (args.includes('--dry-run')) {
    console.log(`(dry-run) would rename ${from} → ${to}`);
    return 0;
  }
  git(['branch', '-m', from, to]);
  // The old upstream (the assigned branch) must not receive the push: the first push sets the new one.
  gitOk(['branch', '--unset-upstream', to]);
  console.log(`[branch-name] ✅ renamed ${from} → ${to}
  first push: git push -u origin ${to}`);
  if (pushed) {
    console.log(
      `  note: origin/${from} has no work of its own; it can be deleted (the cloud proxy rejects deletion: report it).`,
    );
  }
  return 0;
}

function main(): number {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'name') {
      console.log(buildBranchName(specFromArgs(args)));
      return 0;
    }
    if (command === 'check') return runCheck(positionals(args)[0] ?? currentBranch());
    if (command === 'rename') return runRename(args);
  } catch (e) {
    console.error(`[branch-name] ❌ ${(e as Error).message.split('\n')[0]}`);
    return 1;
  }
  printUsage();
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main());
}
