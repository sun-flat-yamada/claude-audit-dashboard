import { spawn } from 'node:child_process';
import {
  parseCountObjects,
  summarizeArchiveEntries,
  type ArchiveEntry,
  type ArchiveSummary,
  type DatasetFootprint,
  type RepoSizeMeasurement,
} from '@claude-audit/core';

/** Runs `git <args>` in `cwd`; resolves with stdout. Injected in tests, `execGit` in production. */
export type GitRunner = (cwd: string, args: readonly string[], input?: string) => Promise<string>;

/** Runs git without a shell (no quoting issues, no injection) and without any prompt. */
export const execGit: GitRunner = (cwd, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', cwd, ...args], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(out).toString('utf8'))
        : reject(
            new Error(
              `git ${args[0] ?? ''} failed (${String(code)}): ${Buffer.concat(err).toString('utf8').trim()}`,
            ),
          ),
    );
    child.stdin.on('error', () => undefined);
    child.stdin.end(input ?? '');
  });

export interface MeasureOptions {
  /** Branch / ref to measure (default: every ref). The data branch is `data/audit`. */
  ref?: string | undefined;
  /** Growth window in days. */
  windowDays?: number | undefined;
  /** Directory of the data inside the repository (`data-branch.sh` stores it under `data/`). */
  dataPrefix?: string | undefined;
  git?: GitRunner | undefined;
}

/** What `measureRepository` returns: the pure measurement plus the shared archive aggregation. */
export interface Measured extends RepoSizeMeasurement {
  /** Per-year archive inventory of the measured tip (the same aggregation the dashboard shows). */
  archiveSummary: ArchiveSummary;
}

const REF = /^[A-Za-z0-9][A-Za-z0-9._/@^~-]{0,199}$/;
const SEGMENT = '[A-Za-z0-9_-][A-Za-z0-9._-]*';
const PREFIX = new RegExp(`^(?:${SEGMENT}(?:/${SEGMENT})*)?$`);
const DAY_SECONDS = 86_400;

interface Commit {
  hash: string;
  time: number;
}

/** Newest first, as `git log` prints them. */
async function listCommits(
  git: GitRunner,
  repo: string,
  rev: readonly string[],
): Promise<Commit[]> {
  const text = await git(repo, ['log', ...rev, '--format=%H %ct']);
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash = '', time = '0'] = line.split(' ');
      return { hash, time: Number(time) };
    });
}

const diskUsage = async (git: GitRunner, repo: string, rev: readonly string[]): Promise<number> =>
  Number((await git(repo, ['rev-list', '--objects', '--disk-usage', ...rev])).trim());

/** Bytes the last `windowDays` days added; null when the history is not that old. */
async function windowGrowth(
  git: GitRunner,
  repo: string,
  commits: readonly Commit[],
  windowDays: number,
  total: number,
): Promise<number | null> {
  const newest = commits[0];
  if (!newest) return null;
  const boundary = commits.find((c) => c.time <= newest.time - windowDays * DAY_SECONDS);
  if (!boundary) return null;
  return Math.max(0, total - (await diskUsage(git, repo, [boundary.hash])));
}

interface ObjectLine {
  sha: string;
  path: string;
}

async function listObjects(
  git: GitRunner,
  repo: string,
  rev: readonly string[],
): Promise<ObjectLine[]> {
  const text = await git(repo, ['rev-list', '--objects', ...rev]);
  return text
    .split('\n')
    .map((line) => {
      const at = line.indexOf(' ');
      return at < 0 ? null : { sha: line.slice(0, at), path: line.slice(at + 1) };
    })
    .filter((line): line is ObjectLine => line !== null);
}

/** On-disk (compressed, deltified) size of each object. */
async function diskSizes(
  git: GitRunner,
  repo: string,
  shas: readonly string[],
): Promise<Map<string, number>> {
  if (shas.length === 0) return new Map();
  const text = await git(
    repo,
    ['cat-file', '--batch-check=%(objectname) %(objectsize:disk)'],
    `${shas.join('\n')}\n`,
  );
  return new Map(
    text
      .split('\n')
      .filter(Boolean)
      .map((line): [string, number] => {
        const [sha = '', size = '0'] = line.split(' ');
        return [sha, Number(size)];
      }),
  );
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface DatasetTotals {
  footprints: DatasetFootprint[];
  snapshots: number;
}

/**
 * Distinct blobs per dataset over the whole history. `rev-list --objects` prints every object
 * once, so identical content (an unchanged dataset in many snapshots) counts as one blob; a blob
 * is attributed to the first path it was found at.
 */
async function datasetFootprints(
  git: GitRunner,
  repo: string,
  rev: readonly string[],
  prefix: string,
): Promise<DatasetTotals> {
  const dir = prefix ? `${escapeRegExp(prefix)}/` : '';
  const pattern = new RegExp(`^${dir}snapshots/[^/]+/([A-Za-z]+)\\.json$`);
  const blobs: { sha: string; dataset: string }[] = [];
  for (const { sha, path } of await listObjects(git, repo, rev)) {
    const dataset = pattern.exec(path)?.[1];
    if (dataset) blobs.push({ sha, dataset });
  }
  const sizes = await diskSizes(
    git,
    repo,
    blobs.map((b) => b.sha),
  );
  const byDataset = new Map<string, DatasetFootprint>();
  for (const { sha, dataset } of blobs) {
    const row = byDataset.get(dataset) ?? { dataset, blobs: 0, bytes: 0 };
    byDataset.set(dataset, {
      dataset,
      blobs: row.blobs + 1,
      bytes: row.bytes + (sizes.get(sha) ?? 0),
    });
  }
  const { manifest, ...datasets } = Object.fromEntries(byDataset);
  return {
    footprints: Object.values(datasets).sort((a, b) => a.dataset.localeCompare(b.dataset)),
    snapshots: manifest?.blobs ?? 0,
  };
}

/** `archive/<year>/<id>.json.gz` of the tip tree as raw inventory entries (compressed size). */
export function archiveEntriesFromTree(lsTree: string, prefix: string): ArchiveEntry[] {
  const root = `${prefix ? `${prefix}/` : ''}archive/`;
  return lsTree
    .split('\0')
    .filter(Boolean)
    .flatMap((record): ArchiveEntry[] => {
      const tab = record.indexOf('\t');
      const path = record.slice(tab + 1);
      const size = Number(record.slice(0, tab).trim().split(/\s+/)[3]);
      if (tab < 0 || !path.startsWith(root) || !Number.isSafeInteger(size)) return [];
      const parts = path.slice(root.length).split('/');
      if (parts.length === 1) return [{ dir: '', name: parts[0] ?? '', bytes: size }];
      if (parts.length === 2) return [{ dir: parts[0] ?? '', name: parts[1] ?? '', bytes: size }];
      return [{ dir: '', name: parts.join('/'), bytes: -1 }];
    });
}

async function archiveSummaryOf(
  git: GitRunner,
  repo: string,
  tip: string,
  prefix: string,
): Promise<ArchiveSummary> {
  const root = `${prefix ? `${prefix}/` : ''}archive`;
  const text = await git(repo, ['ls-tree', '-r', '-l', '-z', tip, '--', root]).catch(() => '');
  return summarizeArchiveEntries(archiveEntriesFromTree(text, prefix));
}

function resolveRev(options: MeasureOptions): { rev: string[]; tip: string } {
  const { ref } = options;
  if (ref !== undefined && !REF.test(ref)) throw new Error(`Invalid ref: ${ref}`);
  return { rev: ref ? [ref] : ['--all'], tip: ref ?? 'HEAD' };
}

/**
 * Measures a git repository (a working tree or a bare clone of the data branch): object counts
 * (`git count-objects -v`), the size of everything reachable, the growth over the last
 * `windowDays` days, per-dataset distinct blobs and the archive inventory of the tip. Read-only;
 * only counts and sizes are returned (no file names, no content).
 */
export async function measureRepository(
  repoDir: string,
  options: MeasureOptions = {},
): Promise<Measured> {
  const git = options.git ?? execGit;
  const windowDays = options.windowDays ?? 30;
  const prefix = options.dataPrefix ?? 'data';
  if (!PREFIX.test(prefix)) throw new Error(`Invalid data prefix: ${prefix}`);
  const { rev, tip } = resolveRev(options);
  const objects = parseCountObjects(await git(repoDir, ['count-objects', '-v']));
  const commits = await listCommits(git, repoDir, rev);
  const newest = commits[0];
  const oldest = commits.at(-1);
  const iso = (c: Commit | undefined): string | null =>
    c ? new Date(c.time * 1000).toISOString() : null;
  if (!newest) return emptyMeasurement(objects, windowDays);
  const reachableBytes = await diskUsage(git, repoDir, rev);
  const totals = await datasetFootprints(git, repoDir, rev, prefix);
  const archiveSummary = await archiveSummaryOf(git, repoDir, tip, prefix);
  return {
    commits: commits.length,
    firstCommitAt: iso(oldest),
    lastCommitAt: iso(newest),
    objects,
    reachableBytes,
    windowDays,
    windowGrowthBytes: await windowGrowth(git, repoDir, commits, windowDays, reachableBytes),
    snapshots: totals.snapshots,
    datasets: totals.footprints,
    archive: {
      snapshots: archiveSummary.totals.snapshots,
      bytes: archiveSummary.totals.bytes,
      years: archiveSummary.totals.years,
    },
    archiveSummary,
  };
}

function emptyMeasurement(objects: RepoSizeMeasurement['objects'], windowDays: number): Measured {
  return {
    commits: 0,
    firstCommitAt: null,
    lastCommitAt: null,
    objects,
    reachableBytes: 0,
    windowDays,
    windowGrowthBytes: null,
    snapshots: 0,
    datasets: [],
    archive: { snapshots: 0, bytes: 0, years: 0 },
    archiveSummary: summarizeArchiveEntries([]),
  };
}
