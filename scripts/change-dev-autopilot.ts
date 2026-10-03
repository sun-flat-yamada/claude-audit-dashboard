/**
 * change-dev Auto-Pilot helper (`.agents/skills/change-dev/SKILL.md`)
 *
 * CHG_DEV_AUTO_PILOT を解決し、change-dev の分岐 (計画レビューの待ち・PR のドラフト・PR 後の自動化) を決める。
 * PR 作成後は、ドラフト解除 → CI 確認 → 承認 → Rebase & Merge を GitHub の REST API で行う。
 *
 * REST だけを使う理由: Claude Code のクラウドセッションは GitHub への通信を GitHub プロキシ経由で行い、
 * GraphQL を 403 で拒否する。`gh pr view` / `gh pr merge` / `gh pr ready` / `gh pr checks` は GraphQL を使うため
 * クラウドでは動かない。`gh api repos/{owner}/{repo}/...` (REST) は動く。ドラフト解除と auto-merge は REST に無く、
 * クラウドでは専用ルート `/pulls/{n}/ccr/ready_for_review` を使う (ローカルは `gh pr ready`)。
 *
 * Usage:
 *   pnpm change-dev:mode                 # 解決したモードと分岐を表示
 *   pnpm change-dev:finish <pr> [--wait] [--dry-run]
 *     終了コード: 0 = マージした (または dry-run で可能)、2 = CI 待ち、1 = 停止 (理由を表示)
 */

import { execFileSync } from 'child_process';
import { checkPlanFirst } from './plan-first-check.js';
import { validateBranchName } from './change-dev-branch.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'CHG_DEV_AUTO_PILOT';

// ---------------------------------------------------------------------------
// モードの解決 (純粋関数)
// ---------------------------------------------------------------------------

export type AutoPilotSource = 'process-env' | '.env' | '.env.example' | 'unset';

export interface AutoPilotResolution {
  enabled: boolean;
  source: AutoPilotSource;
  raw: string | null;
}

/** `.env` 形式 (KEY=value、# コメント、引用符) を読む */
export function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) {
      value = quoted[2];
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    result[m[1]] = value;
  }
  return result;
}

/** `true` (大小文字は問わない) または `1` のとき有効 */
export function isAutoPilotValue(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** 解決順: プロセス環境変数 → `.env` → `.env.example` (リポジトリ既定)。最初に値があったものを使う */
export function resolveAutoPilot(input: {
  env: Record<string, string | undefined>;
  dotEnv?: Record<string, string> | null;
  dotEnvExample?: Record<string, string> | null;
}): AutoPilotResolution {
  const layers: Array<[AutoPilotSource, string | undefined]> = [
    ['process-env', input.env[KEY]],
    ['.env', input.dotEnv?.[KEY]],
    ['.env.example', input.dotEnvExample?.[KEY]],
  ];
  for (const [source, raw] of layers) {
    if (raw !== undefined && raw !== '') {
      return { enabled: isAutoPilotValue(raw), source, raw };
    }
  }
  return { enabled: false, source: 'unset', raw: null };
}

export interface ChangeDevPolicy {
  autoPilot: boolean;
  /** Claude Code のクラウドセッション (CLAUDE_CODE_REMOTE=true) か */
  cloud: boolean;
  /** implementation_plan.md の後: 承認を待つか、そのまま進むか */
  planGate: 'await-user-approval' | 'proceed-and-report';
  /** PR をドラフトで作るか */
  prDraft: boolean;
  /** PR 作成後 */
  afterPr: 'auto-merge' | 'manual';
  /** GitHub 操作の経路 */
  githubTransport: 'rest-via-proxy' | 'gh-cli';
  /** 作業場所 */
  workspace: 'session-branch' | 'sibling-worktree';
}

export function deriveChangeDevPolicy(autoPilot: boolean, cloud: boolean): ChangeDevPolicy {
  return {
    autoPilot,
    cloud,
    planGate: autoPilot ? 'proceed-and-report' : 'await-user-approval',
    prDraft: !autoPilot,
    afterPr: autoPilot ? 'auto-merge' : 'manual',
    githubTransport: cloud ? 'rest-via-proxy' : 'gh-cli',
    workspace: cloud ? 'session-branch' : 'sibling-worktree',
  };
}

// ---------------------------------------------------------------------------
// マージ可否の判定 (純粋関数)
// ---------------------------------------------------------------------------

export interface PullSnapshot {
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  /** GitHub REST の mergeable_state (clean / unstable / blocked / behind / dirty / unknown / draft / has_hooks) */
  mergeableState: string;
  headSha: string;
}

export interface CheckRunSnapshot {
  name: string;
  status: string; // queued / in_progress / completed / waiting / requested / pending
  conclusion: string | null;
}

export interface MergeReadiness {
  state: 'ready' | 'pending' | 'blocked';
  reasons: string[];
}

const FAILED_CONCLUSIONS = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
  'stale',
]);

/**
 * CI とマージ状態から、マージしてよいかを判定する。
 * - 失敗した check run が 1 つでもあれば blocked (自動修正して再 push するのは agent の仕事)
 * - 未完了の check run があれば pending
 * - コンフリクト (dirty) は blocked。mergeable_state の再計算中 (unknown) は pending
 */
export function evaluateMergeReadiness(
  pr: PullSnapshot,
  checkRuns: CheckRunSnapshot[],
): MergeReadiness {
  const reasons: string[] = [];
  if (pr.merged) return { state: 'blocked', reasons: ['already merged'] };
  if (pr.state !== 'open') return { state: 'blocked', reasons: ['pull request is closed'] };

  const failed = checkRuns.filter(
    (c) => c.status === 'completed' && FAILED_CONCLUSIONS.has(c.conclusion ?? ''),
  );
  if (failed.length > 0) {
    return {
      state: 'blocked',
      reasons: failed.map((c) => `check failed: ${c.name} (${c.conclusion})`),
    };
  }
  if (pr.mergeableState === 'dirty') {
    return { state: 'blocked', reasons: ['merge conflict with the base branch'] };
  }

  const running = checkRuns.filter((c) => c.status !== 'completed');
  if (running.length > 0) reasons.push(...running.map((c) => `check running: ${c.name}`));
  if (pr.mergeableState === 'unknown') reasons.push('mergeability is being computed');
  return reasons.length > 0 ? { state: 'pending', reasons } : { state: 'ready', reasons: [] };
}

/** GitHub は PR の作成者による承認を 422 で拒否する */
export function isSelfApprovalRejection(message: string): boolean {
  return /approve your own pull request/i.test(message);
}

// ---------------------------------------------------------------------------
// GitHub REST (gh api)
// ---------------------------------------------------------------------------

function gh(args: string[]): string {
  return execFileSync('gh', args, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function ghErrorText(e: unknown): string {
  const err = e as { stderr?: string; stdout?: string; message?: string };
  return `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`;
}

function ghApi<T>(method: string, route: string, fields: Record<string, string> = {}): T {
  const args = ['api', '--method', method, route];
  for (const [k, v] of Object.entries(fields)) args.push('-f', `${k}=${v}`);
  const out = gh(args);
  return (out.trim() ? JSON.parse(out) : {}) as T;
}

function repoSlug(): string {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  }).trim();
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`origin is not a github.com repository: ${url}`);
  return `${m[1]}/${m[2]}`;
}

interface RestPull {
  state: 'open' | 'closed';
  merged?: boolean;
  draft?: boolean;
  mergeable_state?: string;
  head: { sha: string; ref: string };
  base: { ref: string };
}

interface RestCheckRuns {
  check_runs?: Array<{ name: string; status: string; conclusion: string | null }>;
}

interface RestProtection {
  required_pull_request_reviews?: { required_approving_review_count?: number };
}

function readPull(repo: string, pr: number): PullSnapshot & { baseRef: string; headRef: string } {
  const p = ghApi<RestPull>('GET', `repos/${repo}/pulls/${pr}`);
  return {
    state: p.state,
    merged: !!p.merged,
    draft: !!p.draft,
    mergeableState: p.mergeable_state ?? 'unknown',
    headSha: p.head.sha,
    baseRef: p.base.ref,
    headRef: p.head.ref,
  };
}

function readCheckRuns(repo: string, sha: string): CheckRunSnapshot[] {
  const r = ghApi<RestCheckRuns>('GET', `repos/${repo}/commits/${sha}/check-runs?per_page=100`);
  return (r.check_runs ?? []).map((c) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion,
  }));
}

/** ブランチ保護が要求する承認数。保護が無い・読めない場合は 0 */
function requiredApprovals(repo: string, branch: string): number {
  try {
    const p = ghApi<RestProtection>('GET', `repos/${repo}/branches/${branch}/protection`);
    return p.required_pull_request_reviews?.required_approving_review_count ?? 0;
  } catch {
    return 0;
  }
}

function markReady(repo: string, pr: number, cloud: boolean): void {
  if (cloud) {
    ghApi('POST', `repos/${repo}/pulls/${pr}/ccr/ready_for_review`);
  } else {
    gh(['pr', 'ready', String(pr), '--repo', repo]);
  }
}

/** 承認を試みる。作成者自身の PR は GitHub が拒否するため、その場合は 'self' を返す */
function approve(repo: string, pr: number, sha: string): 'approved' | 'self' {
  try {
    ghApi('POST', `repos/${repo}/pulls/${pr}/reviews`, {
      event: 'APPROVE',
      commit_id: sha,
      body: 'change-dev Auto-Pilot: quality gate and CI passed on this head.',
    });
    return 'approved';
  } catch (e) {
    if (isSelfApprovalRejection(ghErrorText(e))) return 'self';
    throw e;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readEnvFile(name: string): Record<string, string> | null {
  const file = path.join(REPO_ROOT, name);
  return fs.existsSync(file) ? parseEnvFile(fs.readFileSync(file, 'utf-8')) : null;
}

export function currentPolicy(): { resolution: AutoPilotResolution; policy: ChangeDevPolicy } {
  const resolution = resolveAutoPilot({
    env: process.env,
    dotEnv: readEnvFile('.env'),
    dotEnvExample: readEnvFile('.env.example'),
  });
  const cloud = process.env.CLAUDE_CODE_REMOTE === 'true';
  return { resolution, policy: deriveChangeDevPolicy(resolution.enabled, cloud) };
}

function printMode(): void {
  const { resolution, policy } = currentPolicy();
  console.log(JSON.stringify({ [KEY]: resolution, policy }, null, 2));
}

/** マージ済み PR のヘッドブランチを削除する。ベースブランチは決して削除しない */
function deleteMergedBranch(
  repo: string,
  headRef: string,
  baseRef: string,
): 'deleted' | 'failed' | 'skipped' {
  if (!headRef || headRef === baseRef || headRef === 'main') return 'skipped';
  try {
    execFileSync('git', ['push', 'origin', '--delete', headRef], { cwd: REPO_ROOT, stdio: 'pipe' });
    return 'deleted';
  } catch {
    // 続けて REST を試す
  }
  try {
    ghApi('DELETE', `repos/${repo}/git/refs/heads/${headRef}`);
    return 'deleted';
  } catch {
    return 'failed';
  }
}

/** PR の head (ローカルに無ければ fetch) と base の差分で計画先行を検査する */
function checkPlanFirstForPull(pull: PullSnapshot & { baseRef: string; headRef: string }) {
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: REPO_ROOT, stdio: 'pipe', encoding: 'utf-8' });
  try {
    git(['fetch', '--quiet', 'origin', pull.baseRef, pull.headRef]);
  } catch {
    // オフライン等。手元の参照で続ける
  }
  let head = pull.headSha;
  try {
    git(['cat-file', '-e', `${head}^{commit}`]);
  } catch {
    head = 'HEAD';
  }
  try {
    return checkPlanFirst(REPO_ROOT, `origin/${pull.baseRef}`, head);
  } catch (e) {
    return {
      ok: false,
      exempt: false,
      message: `could not read git history: ${(e as Error).message.split('\n')[0]}`,
    };
  }
}

async function finish(prArg: string | undefined, flags: Set<string>): Promise<number> {
  const pr = Number(prArg);
  if (!Number.isInteger(pr) || pr <= 0) {
    console.error('Usage: pnpm change-dev:finish <pr-number> [--wait] [--dry-run]');
    return 1;
  }
  const { resolution, policy } = currentPolicy();
  if (!policy.autoPilot && !flags.has('--force')) {
    console.error(
      `❌ ${KEY} is not enabled (source: ${resolution.source}). Merge manually, or pass --force.`,
    );
    return 1;
  }
  const dryRun = flags.has('--dry-run');
  const repo = repoSlug();

  let pull = readPull(repo, pr);

  // 計画先行の検査 (implementation_plan.md が実装より前のコミットにあること)。状態を変える操作の前に行う。
  const planCheck = checkPlanFirstForPull(pull);
  if (!planCheck.ok) {
    console.error(`🛑 plan-first check failed: ${planCheck.message}`);
    return 1;
  }
  console.log(`✅ ${planCheck.message}`);

  // ブランチ名の検査 (`<type>/<issue>-<slug>`)。クラウドの既定名 `claude/<adj>-<name>-<id>` のままのヘッドはマージしない。
  const branchCheck = validateBranchName(pull.headRef);
  if (branchCheck.status === 'invalid') {
    console.error(`🛑 branch name check failed: ${branchCheck.reasons.join('; ')}`);
    return 1;
  }
  console.log(`✅ branch name: ${pull.headRef}`);

  if (pull.draft) {
    console.log(`📝 PR #${pr} is a draft → marking ready for review`);
    if (!dryRun) markReady(repo, pr, policy.cloud);
  }

  // CI 待ち。--wait のときだけ 30 秒ごとに最大 30 分待つ。クラウドでは PR イベント (check_suite.completed) で
  // 起こされるため待たずに 2 を返し、イベント後に再実行する。
  const deadline = Date.now() + 30 * 60 * 1000;
  let readiness: MergeReadiness;
  for (;;) {
    pull = readPull(repo, pr);
    readiness = evaluateMergeReadiness(pull, readCheckRuns(repo, pull.headSha));
    if (readiness.state !== 'pending' || !flags.has('--wait') || Date.now() > deadline) break;
    console.log(`⏳ waiting: ${readiness.reasons.join('; ')}`);
    await new Promise((r) => setTimeout(r, 30_000));
  }

  if (readiness.state === 'pending') {
    console.log(`⏳ PR #${pr} is not ready yet: ${readiness.reasons.join('; ')}`);
    return 2;
  }
  if (readiness.state === 'blocked') {
    console.error(`🛑 PR #${pr} cannot be merged: ${readiness.reasons.join('; ')}`);
    return 1;
  }

  const required = requiredApprovals(repo, pull.baseRef);
  if (!dryRun) {
    const result = approve(repo, pr, pull.headSha);
    if (result === 'self') {
      console.log(
        'ℹ️  GitHub rejected the approval: the PR author cannot approve their own pull request.',
      );
      if (required > 0) {
        console.error(
          `🛑 ${pull.baseRef} requires ${required} approval(s); another account must approve.`,
        );
        return 1;
      }
      console.log(`✅ ${pull.baseRef} requires 0 approvals → continuing without an approval.`);
    } else {
      console.log('✅ approved');
    }
  } else {
    console.log(`(dry-run) would approve; ${pull.baseRef} requires ${required} approval(s)`);
  }

  if (dryRun) {
    console.log(`(dry-run) would rebase-merge PR #${pr} at ${pull.headSha}`);
    return 0;
  }
  ghApi('PUT', `repos/${repo}/pulls/${pr}/merge`, { merge_method: 'rebase', sha: pull.headSha });
  console.log(`🎉 PR #${pr} rebase-merged into ${pull.baseRef}`);

  // マージ後のブランチ削除 (ローカル・クラウド共通)。git → REST の順に試す。
  // クラウドの GitHub プロキシがどちらも拒否した場合は黙って残さず、手動削除が必要なことを報告する (exit code は 0 のまま)。
  const deleted = deleteMergedBranch(repo, pull.headRef, pull.baseRef);
  if (deleted === 'failed') {
    console.warn(
      `⚠️  could not delete remote branch ${pull.headRef}: delete it manually (GitHub UI, or enable "Automatically delete head branches" in the repository settings).`,
    );
  } else if (deleted === 'deleted') {
    console.log(`🧹 deleted remote branch ${pull.headRef}`);
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('change-dev-autopilot.ts')) {
  const [command, ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const positional = rest.filter((a) => !a.startsWith('--'));
  if (command === 'mode') {
    printMode();
  } else if (command === 'finish') {
    finish(positional[0], flags)
      .then((code) => process.exit(code))
      .catch((e) => {
        console.error(`❌ ${ghErrorText(e)}`);
        process.exit(1);
      });
  } else {
    console.error('Usage: tsx scripts/change-dev-autopilot.ts <mode|finish> ...');
    process.exit(1);
  }
}
