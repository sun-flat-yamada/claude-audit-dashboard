/**
 * Noreply commit e-mail gate (#179, `.agents/rules/git-rules-commit.md` §5).
 *
 * Every commit that can reach upstream `main` must record noreply addresses only: the author, the committer,
 * every `*-by:` trailer (`Co-Authored-By`, `Signed-off-by`, ...) and any address in the message text.
 * A personal or corporate address in a public commit is PII that cannot be removed from the history later.
 *
 *   pnpm commit-email:check                          # origin/main..HEAD
 *   pnpm commit-email:check --range <base>..<head>   # CI (pull_request / push)
 *   pnpm commit-email:check -- <git log revisions>   # pre-push hook (e.g. <sha> --not --remotes=origin)
 *   pnpm commit-email:check --message-file <file>    # commit-msg hook: the commit being made
 *
 * Offending addresses are printed masked (`j***@e***.com`), never in full.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The only addresses a commit identity or trailer may carry. Keep this the single list. */
export const ALLOWED_EMAILS: readonly RegExp[] = [
  // GitHub noreply: `<id>+<login>@`, the older `<login>@` and bot forms (`<id>+name[bot]@`).
  /^[^\s@<>]+@users\.noreply\.github\.com$/i,
  // GitHub web-flow committer (web edits, merges made on github.com).
  /^noreply@github\.com$/i,
  // Claude Code agents.
  /^noreply@anthropic\.com$/i,
];

/**
 * Service trailers accepted besides the list above, by exact name and address. Dependabot adds
 * `Signed-off-by: dependabot[bot] <support@github.com>` to every commit (a GitHub role address, not a person).
 */
export const SERVICE_TRAILERS: readonly { name: string; email: string }[] = [
  { name: 'dependabot[bot]', email: 'support@github.com' },
];

/** Reserved example domains (RFC 2606), accepted in the free text of a message only. */
const EXAMPLE_DOMAIN = /(^|\.)example(\.(com|org|net))?$/i;

// The top-level label must be alphabetic, so `pnpm@9.15.4` or `@types/node@26.6.5` are not addresses.
const EMAIL = /[A-Za-z0-9._%+-]+(?:\[bot\])?@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g;
const TRAILER = /^([A-Za-z][A-Za-z0-9-]*-by):\s*(.*?)\s*<([^<>\s]+)>\s*$/i;

export interface CommitIdentity {
  sha: string;
  authorEmail: string;
  committerEmail: string;
  message: string;
}

export interface EmailIssue {
  sha: string;
  /** `author`, `committer`, `trailer <Key>` or `message` */
  field: string;
  /** Masked address, safe to log */
  masked: string;
}

export interface Trailer {
  key: string;
  name: string;
  email: string;
}

export function isAllowedEmail(email: string): boolean {
  return ALLOWED_EMAILS.some((re) => re.test(email.trim()));
}

function isServiceTrailer(t: Trailer): boolean {
  return SERVICE_TRAILERS.some(
    (s) => s.name === t.name && s.email.toLowerCase() === t.email.toLowerCase(),
  );
}

/** `jane.doe@example.co.jp` -> `j***@e***.jp`. The empty string and malformed values become `***`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}***@${domain[0]}***${tld}`;
}

/** `*-by:` lines that carry an address in angle brackets, anywhere in the message. */
export function parseTrailers(message: string): Trailer[] {
  const out: Trailer[] = [];
  for (const line of message.split('\n')) {
    const m = TRAILER.exec(line.trim());
    if (m) out.push({ key: m[1], name: m[2], email: m[3] });
  }
  return out;
}

function messageTextIssues(sha: string, message: string): EmailIssue[] {
  const text = message
    .split('\n')
    .filter((line) => !TRAILER.test(line.trim()))
    .join('\n');
  const issues: EmailIssue[] = [];
  for (const email of text.match(EMAIL) ?? []) {
    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (isAllowedEmail(email) || EXAMPLE_DOMAIN.test(domain)) continue;
    issues.push({ sha, field: 'message', masked: maskEmail(email) });
  }
  return issues;
}

export function findEmailIssues(commit: CommitIdentity): EmailIssue[] {
  const issues: EmailIssue[] = [];
  const { sha } = commit;
  if (!isAllowedEmail(commit.authorEmail))
    issues.push({ sha, field: 'author', masked: maskEmail(commit.authorEmail) });
  if (!isAllowedEmail(commit.committerEmail))
    issues.push({ sha, field: 'committer', masked: maskEmail(commit.committerEmail) });
  for (const t of parseTrailers(commit.message)) {
    if (isAllowedEmail(t.email) || isServiceTrailer(t)) continue;
    issues.push({ sha, field: `trailer ${t.key}`, masked: maskEmail(t.email) });
  }
  return [...issues, ...messageTextIssues(sha, commit.message)];
}

const US = '\x1f';
const RS = '\x1e';
export const LOG_FORMAT = `%H${US}%ae${US}%ce${US}%B${RS}`;

/** Parses `git log --format=LOG_FORMAT` output. */
export function parseGitLog(output: string): CommitIdentity[] {
  return output
    .split(RS)
    .map((record) => record.replace(/^\n+/, ''))
    .filter((record) => record.includes(US))
    .map((record) => {
      const [sha = '', authorEmail = '', committerEmail = '', message = ''] = record.split(US);
      return { sha, authorEmail, committerEmail, message };
    });
}

/** `Name <email> 1700000000 +0000` (the `git var GIT_*_IDENT` form) -> `email` */
export function emailFromIdent(ident: string): string {
  const m = /<([^<>]*)>/.exec(ident);
  return m ? m[1] : '';
}

export function formatIssues(issues: readonly EmailIssue[]): string {
  return issues
    .map((i) => `  ${i.sha.slice(0, 7)} ${i.field}: ${i.masked} is not a noreply address`)
    .join('\n');
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

export function readCommits(repoRoot: string, revisions: readonly string[]): CommitIdentity[] {
  return parseGitLog(git(repoRoot, ['log', `--format=${LOG_FORMAT}`, ...revisions, '--']));
}

/** The commit `git commit` is about to create: the configured identities and the message file. */
export function pendingCommit(repoRoot: string, messageFile: string): CommitIdentity {
  const message = readFileSync(messageFile, 'utf-8')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n');
  return {
    sha: '(new)',
    authorEmail: emailFromIdent(git(repoRoot, ['var', 'GIT_AUTHOR_IDENT'])),
    committerEmail: emailFromIdent(git(repoRoot, ['var', 'GIT_COMMITTER_IDENT'])),
    message,
  };
}

export interface CliArgs {
  revisions: string[];
  messageFile?: string;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const dashdash = argv.indexOf('--');
  const own = dashdash >= 0 ? argv.slice(0, dashdash) : [...argv];
  const passthrough = dashdash >= 0 ? argv.slice(dashdash + 1) : [];
  const value = (name: string): string | undefined => {
    const i = own.indexOf(name);
    return i >= 0 ? own[i + 1] : undefined;
  };
  const range = value('--range');
  const messageFile = value('--message-file');
  const revisions = [...(range ? [range] : []), ...passthrough];
  if (messageFile) return { revisions, messageFile };
  return { revisions: revisions.length > 0 ? revisions : ['origin/main..HEAD'] };
}

const HELP =
  'Use a noreply address: git config user.email "<id>+<login>@users.noreply.github.com" ' +
  '(GitHub > Settings > Emails), then rewrite the listed commits, e.g. ' +
  "git rebase --exec 'git commit --amend --no-edit --reset-author' origin/main " +
  '(and fix any trailer by hand). See CONTRIBUTING.md (Commit identity).';

function main(): void {
  const repoRoot = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  let commits: CommitIdentity[];
  try {
    commits = args.messageFile
      ? [pendingCommit(repoRoot, args.messageFile)]
      : readCommits(repoRoot, args.revisions);
  } catch (e) {
    console.error(
      `[commit-email] could not read the commits: ${(e as Error).message.split('\n')[0]}`,
    );
    process.exit(1);
  }
  const issues = commits.flatMap(findEmailIssues);
  if (issues.length === 0) {
    console.log(
      `[commit-email] ✅ ${commits.length} commit(s) record noreply e-mail addresses only.`,
    );
    return;
  }
  console.error(`[commit-email] ❌ ${issues.length} non-noreply e-mail address(es):`);
  console.error(formatIssues(issues));
  console.error(`[commit-email] ${HELP}`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
