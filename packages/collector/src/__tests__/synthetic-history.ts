import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import {
  BUILTIN_PROJECTIONS,
  ALL_DATASET_NAMES,
  DATASET_NAMES,
  SNAPSHOT_SCHEMA_VERSION,
  applyProjections,
  defaultRange,
  gatherDatasets,
  round,
  timestampId,
  toIsoDate,
  type AuditSnapshot,
  type DatasetName,
} from '@claude-audit/core';
import { createDemoOptionalCollectors } from '../adapters/demo/demo-optional.js';
import { DEMO_NOW, createDemoCollectors } from '../adapters/demo/demo-source.js';
import { snapshotFiles } from '../adapters/storage/repositories.js';

/**
 * Test support: a long, deterministic history of snapshots and a temporary git repository that
 * records it commit by commit, like the data/audit branch grows in production (one snapshot
 * every 6 hours). Everything derives from the demo synthetic tenant (example.com only) and a
 * fixed clock, so two runs produce byte-identical files and identical commit ids.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Start of the synthetic history (a fixed clock; nothing reads the real time). */
export const HISTORY_START = new Date('2025-01-01T00:00:00.000Z');

export interface HistoryOptions {
  /** Length of the history in days (e.g. 400). */
  days: number;
  /** Hours between snapshots (default 6, the collect-audit schedule). */
  intervalHours?: number;
  start?: Date;
  /**
   * Also carry the datasets of the optional sources (B4: Console, Claude Code). Off by default,
   * so existing tests keep the 13 built-in datasets.
   */
  optionalSources?: boolean;
}

/**
 * How often (in snapshots) each dataset's content changes. The default interval of 6 hours means
 * 4 snapshots per day: `4` is daily, `28` weekly. `Infinity` never changes after the first
 * snapshot, so git stores it once; `1` changes every snapshot (new activity events only).
 */
export const CHANGE_PERIOD: Readonly<Record<DatasetName, number>> = {
  organizations: Infinity,
  settings: 240,
  groups: 120,
  credentials: 56,
  credentialUsage: 28,
  members: 28,
  invites: 12,
  spendLimits: 4,
  memberActivity: 4,
  adoption: 4,
  usage: 4,
  cost: 4,
  activities: 1,
  consoleWorkspaces: 240,
  consoleApiKeys: 56,
  consoleUsage: 4,
  consoleCost: 4,
  claudeCodeActivity: 4,
};

type Row = Record<string, unknown>;
type Items = Row[];

/** Days of rolling usage / cost / adoption rows a snapshot carries (the collector's range). */
const ROLLING_DAYS = 30;

interface Base {
  data: Record<DatasetName, Items>;
  coverage: AuditSnapshot['coverage'];
}

/** The demo tenant collected once at its own fixed clock (datasets + projections). */
async function baseSnapshot(names: readonly DatasetName[]): Promise<Base> {
  const now = DEMO_NOW;
  const collectors = [
    ...createDemoCollectors(),
    ...(names.length > DATASET_NAMES.length ? createDemoOptionalCollectors() : []),
  ];
  const gathered = await gatherDatasets(collectors, { now, range: defaultRange(now) });
  applyProjections(BUILTIN_PROJECTIONS, gathered, {}, now);
  const data = Object.fromEntries(
    names.map((name) => [name, (gathered.data[name] ?? []) as unknown as Items]),
  ) as Record<DatasetName, Items>;
  return { data, coverage: gathered.coverage };
}

/** Deterministic factor in [0.5, 1.5) per date, so rolling rows differ day to day. */
function factor(date: string): number {
  let h = 2166136261;
  for (const c of date) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return 0.5 + ((h >>> 0) % 1000) / 1000;
}

const dateOf = (start: Date, offsetDays: number): string =>
  toIsoDate(new Date(start.getTime() + offsetDays * DAY_MS));

function scaleRow(row: Row, date: string): Row {
  const f = factor(date);
  const scaled: Row = { ...row, date };
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'number' && key !== 'date') scaled[key] = round(value * f);
  }
  return scaled;
}

/** Rows of the template's first day re-dated for the last `ROLLING_DAYS` days up to `now`. */
function rollingRows(template: Items, now: Date): Items {
  const firstDate = template[0]?.date;
  const day = template.filter((r) => r.date === firstDate);
  const rows: Items = [];
  for (let back = ROLLING_DAYS - 1; back >= 0; back -= 1) {
    const date = dateOf(now, -back);
    for (const row of day) rows.push(scaleRow(row, date));
  }
  return rows;
}

function newActivities(template: Items, step: number, now: Date): Items {
  return [0, 1, 2].map((k) => {
    const source = template[(step * 3 + k) % template.length] ?? {};
    return {
      ...source,
      id: `synthetic-activity-${String(step).padStart(6, '0')}-${String(k)}`,
      createdAt: new Date(now.getTime() - k * 60_000).toISOString(),
    };
  });
}

const withSuffix = (row: Row, key: string, suffix: string): Row => ({
  ...row,
  [key]: `${String(row[key])}${suffix}`,
});

/** The items of `name` for epoch `epoch` (the number of changes so far) at `now`. */
function variant(name: DatasetName, base: Items, epoch: number, step: number, now: Date): Items {
  const [first] = base;
  switch (name) {
    case 'organizations':
      return base;
    case 'settings':
      return base.map((row, i) =>
        i === 0
          ? {
              ...row,
              values: { ...(row.values as Row), synthetic_epoch: { type: 'number', value: epoch } },
            }
          : row,
      );
    case 'groups':
      return base.map((row, i) =>
        i === 0 ? { ...row, memberCount: Number(row.memberCount ?? 0) + epoch } : row,
      );
    case 'credentials':
      return first && epoch > 0
        ? [
            ...base,
            {
              ...withSuffix(first, 'id', `-s${String(epoch)}`),
              name: `Synthetic key ${String(epoch)}`,
            },
          ]
        : base;
    case 'credentialUsage':
      return base.map((row) => ({ ...row, lastSeenAt: now.toISOString() }));
    case 'members':
      return first && epoch > 0
        ? [
            ...base,
            ...Array.from({ length: epoch }, (_, i) => ({
              ...first,
              id: `synthetic-member-${String(i + 1)}`,
              email: `synthetic.member${String(i + 1)}@example.com`,
              name: `Synthetic Member ${String(i + 1)}`,
              role: 'user',
            })),
          ]
        : base;
    case 'invites':
      return base.map((row, i) => (i === 0 ? withSuffix(row, 'id', `-s${String(epoch)}`) : row));
    case 'spendLimits':
      return base.map((row) => ({ ...row, spent: round(Number(row.spent ?? 0) + (epoch % 7)) }));
    case 'memberActivity':
      return base.map((row) => (row.active ? { ...row, lastActiveOn: toIsoDate(now) } : row));
    case 'consoleWorkspaces':
      return base;
    case 'consoleApiKeys':
      return first && epoch > 0
        ? [
            ...base,
            {
              ...withSuffix(first, 'id', `-s${String(epoch)}`),
              name: `synthetic-key-${String(epoch)}`,
            },
          ]
        : base;
    case 'adoption':
    case 'usage':
    case 'cost':
    case 'consoleUsage':
    case 'consoleCost':
    case 'claudeCodeActivity':
      return rollingRows(base, now);
    case 'activities':
      return newActivities(base, step, now);
  }
}

const epochOf = (name: DatasetName, step: number): number => {
  const period = CHANGE_PERIOD[name];
  return Number.isFinite(period) ? Math.floor(step / period) : 0;
};

/** Items per dataset and epoch are computed once: an unchanged dataset is the same array. */
type Memo = Map<string, Items>;

function itemsFor(
  base: Base,
  name: DatasetName,
  step: number,
  now: Date,
  context: { intervalMs: number; memo: Memo },
): Items {
  const period = CHANGE_PERIOD[name];
  const epoch = epochOf(name, step);
  const key = `${name}:${String(epoch)}`;
  // The content is a function of the epoch's first step, never of the current step.
  const epochNow = Number.isFinite(period)
    ? new Date(HISTORY_START.getTime() + epoch * period * context.intervalMs)
    : now;
  if (name === 'activities') return variant(name, base.data[name], epoch, step, now);
  const cached = context.memo.get(key);
  if (cached) return cached;
  const items = variant(name, base.data[name], epoch, step, epochNow);
  context.memo.set(key, items);
  return items;
}

function snapshotAt(
  names: readonly DatasetName[],
  base: Base,
  step: number,
  now: Date,
  context: { intervalMs: number; memo: Memo },
): AuditSnapshot {
  const data: Record<string, unknown[]> = {};
  const coverage: AuditSnapshot['coverage'] = {};
  for (const name of names) {
    const items = itemsFor(base, name, step, now, context);
    data[name] = items;
    coverage[name] = { ...base.coverage[name], status: 'ok', count: items.length } as never;
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: timestampId(now),
    collectedAt: now.toISOString(),
    coverage,
    data,
  };
}

export interface SyntheticHistory {
  /** Number of snapshots. */
  count: number;
  /** The `i`-th snapshot (0-based), computed on demand. */
  at(i: number): AuditSnapshot;
  /** Collection time of the `i`-th snapshot. */
  timeOf(i: number): Date;
}

/** Prepares a history of `days` x (24 / intervalHours) snapshots derived from the demo tenant. */
export async function createHistory(options: HistoryOptions): Promise<SyntheticHistory> {
  const intervalMs = (options.intervalHours ?? 6) * HOUR_MS;
  const start = options.start ?? HISTORY_START;
  const names = options.optionalSources ? ALL_DATASET_NAMES : DATASET_NAMES;
  const base = await baseSnapshot(names);
  const context = { intervalMs, memo: new Map<string, Items>() };
  const timeOf = (i: number) => new Date(start.getTime() + i * intervalMs);
  return {
    count: Math.floor((options.days * DAY_MS) / intervalMs),
    at: (i) => snapshotAt(names, base, i, timeOf(i), context),
    timeOf,
  };
}

// ─── Temporary git repository ──────────────────────────────────────────────────────────────────

export const HISTORY_BRANCH = 'data/audit';

/** Runs git in `repo` with fixed identity and no global configuration. */
export function git(repo: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: repo,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'synthetic',
      GIT_AUTHOR_EMAIL: 'synthetic@example.com',
      GIT_COMMITTER_NAME: 'synthetic',
      GIT_COMMITTER_EMAIL: 'synthetic@example.com',
      ...env,
    },
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * Builds the fast-import stream: one commit per snapshot, each adding that snapshot's files
 * under `data/` (the layout `data-branch.sh save` produces). A commit keeps its parent's tree, so
 * only the new files are listed; git stores identical content once, which is exactly the
 * deduplication under test.
 */
function importStream(history: SyntheticHistory): string[] {
  const parts: string[] = [];
  let mark = 0;
  const addBlob = (content: string): number => {
    mark += 1;
    parts.push(
      `blob\nmark :${String(mark)}\ndata ${String(Buffer.byteLength(content))}\n${content}\n`,
    );
    return mark;
  };
  // An unchanged dataset is the same array in every snapshot: serialize and send it once.
  const marks = new WeakMap<object, number>();
  const datasetMark = (snapshot: AuditSnapshot, name: DatasetName): number => {
    const items = snapshot.data[name] as object;
    const known = marks.get(items);
    if (known !== undefined) return known;
    const only = { ...snapshot, data: { [name]: items }, coverage: {} };
    const [[, content]] = snapshotFiles('d', only) as [[string, string]];
    const created = addBlob(content);
    marks.set(items, created);
    return created;
  };
  for (let i = 0; i < history.count; i += 1) {
    const snapshot = history.at(i);
    const unix = Math.floor(history.timeOf(i).getTime() / 1000);
    const message = `chore: audit data ${snapshot.id} [skip ci]`;
    const base = `data/snapshots/${snapshot.id}`;
    const changes = (Object.keys(snapshot.data) as DatasetName[]).map(
      (name) => `M 100644 :${String(datasetMark(snapshot, name))} ${base}/${name}.json`,
    );
    const [manifest] = snapshotFiles('d', { ...snapshot, data: {} }).slice(-1);
    changes.push(`M 100644 :${String(addBlob(manifest?.[1] ?? ''))} ${base}/manifest.json`);
    parts.push(
      `commit refs/heads/${HISTORY_BRANCH}\ncommitter synthetic <synthetic@example.com> ${String(unix)} +0000\ndata ${String(Buffer.byteLength(message))}\n${message}\n${changes.join('\n')}\n\n`,
    );
  }
  return parts;
}

export interface BuiltRepo {
  dir: string;
  commits: number;
}

/**
 * Creates `<dir>` as a git repository whose `data/audit` branch holds one commit per snapshot
 * of `history` (committed at the snapshot's own time). `checkout` also writes the last state into
 * the working tree (slower; needed to archive or restore with the real code).
 * Deterministic: the same history always yields the same commit ids.
 */
export async function buildHistoryRepo(
  dir: string,
  history: SyntheticHistory,
  options: { checkout?: boolean } = {},
): Promise<BuiltRepo> {
  await mkdir(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', HISTORY_BRANCH]);
  const stream = importStream(history).join('');
  const result = spawnSync(
    'git',
    ['-C', dir, '-c', 'pack.compression=1', 'fast-import', '--quiet'],
    {
      input: stream,
      env: { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_GLOBAL: '/dev/null' },
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (result.status !== 0) throw new Error(`git fast-import failed: ${String(result.stderr)}`);
  if (options.checkout) git(dir, ['reset', '-q', '--hard', HISTORY_BRANCH]);
  return { dir, commits: history.count };
}

/** Commits the whole working tree (additions and deletions) at a fixed time. */
export function commitWorkingTree(dir: string, message: string, at: Date): void {
  const date = at.toISOString();
  git(dir, ['add', '-A', 'data'], {});
  git(dir, ['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
}

/** Repacks so reachable sizes are those of a pushed / cloned repository (deltas applied). */
export function repack(dir: string): void {
  git(dir, ['repack', '-a', '-d', '-q']);
}
