import type { LedgerEntry, LedgerHasher } from '../../domain/ledger/entry.js';
import { ledgerEntriesOf, mergeLedgerEntries } from '../../domain/ledger/ledger.js';
import { snapshotBreakdownGaps, type BreakdownGap } from '../../domain/ledger/reconcile.js';
import { revisionEntries } from '../../domain/ledger/seal.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import type { LedgerRepository } from '../ports.js';

export interface LedgerUpdateDeps {
  repository: LedgerRepository;
  hash: LedgerHasher;
  /** Snapshots merged in memory before the files are written (bounds memory in a bootstrap). */
  batchSize?: number;
}

export interface LedgerUpdateResult {
  /** Snapshots read. */
  snapshots: number;
  /** `yyyy-mm/<dataset>` files whose content changed. */
  changed: string[];
  /** Months whose manifest was written. */
  manifests: string[];
  /** Sealed months that new data touched (their files are left unchanged). */
  sealed: string[];
  /** Entries that would have changed a sealed month, appended to its `revisions/` instead. */
  revisions: LedgerRevisionNote[];
  /** Rows per dataset without a usable time (not recorded). */
  rejected: Record<string, number>;
  /**
   * Days of the recorded snapshots whose model breakdown of `usage` / `cost` does not add up to
   * the total row (reported, never a failure; the newest snapshot's finding per day wins).
   */
  gaps: BreakdownGap[];
}

/** New revision entries of one sealed month's dataset. */
export interface LedgerRevisionNote {
  month: string;
  dataset: string;
  count: number;
}

/** New entries of the current batch: month -> dataset -> entries. */
type Pending = Map<string, Map<string, LedgerEntry[]>>;

function addSnapshot(
  pending: Pending,
  snapshot: AuditSnapshot,
  hash: LedgerHasher,
  result: LedgerUpdateResult,
): void {
  const { entries, rejected } = ledgerEntriesOf(snapshot, hash);
  for (const { month, dataset, entry } of entries) {
    const byDataset = pending.get(month) ?? new Map<string, LedgerEntry[]>();
    pending.set(month, byDataset);
    const list = byDataset.get(dataset) ?? [];
    byDataset.set(dataset, list);
    list.push(entry);
  }
  for (const [dataset, count] of Object.entries(rejected))
    result.rejected[dataset] = (result.rejected[dataset] ?? 0) + count;
  recordGaps(result, snapshot);
}

const gapKey = (gap: BreakdownGap): string => `${gap.dataset}|${gap.dimension}|${gap.date}`;

/** Keeps one finding per dataset, dimension and day: the later snapshot replaces the earlier. */
function recordGaps(result: LedgerUpdateResult, snapshot: AuditSnapshot): void {
  const found = snapshotBreakdownGaps(snapshot);
  if (found.length === 0) return;
  const keys = new Set(found.map(gapKey));
  result.gaps = [...result.gaps.filter((gap) => !keys.has(gapKey(gap))), ...found];
}

const sorted = <T>(values: Iterable<[string, T]>): [string, T][] =>
  [...values].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Appends to `revisions/` the entries of `incoming` that would change the sealed file of
 * `dataset` (merged by the kind's rule, so a repeated difference is stored once); the sealed file
 * stays unchanged. Resolves the number of entries that are new to the revisions.
 */
export async function recordRevisions(
  repository: LedgerRepository,
  month: string,
  dataset: string,
  incoming: readonly LedgerEntry[],
): Promise<number> {
  const found = revisionEntries(dataset, await repository.read(month, dataset), incoming);
  if (found.length === 0) return 0;
  const held = await repository.readRevisions(month, dataset);
  const fresh = revisionEntries(dataset, held, found);
  if (fresh.length === 0) return 0;
  await repository.writeRevisions(month, dataset, mergeLedgerEntries(dataset, [...held, ...found]));
  return fresh.length;
}

async function flushSealed(
  month: string,
  byDataset: Map<string, LedgerEntry[]>,
  repository: LedgerRepository,
  result: LedgerUpdateResult,
): Promise<void> {
  if (!result.sealed.includes(month)) result.sealed.push(month);
  for (const [dataset, incoming] of sorted(byDataset)) {
    const count = await recordRevisions(repository, month, dataset, incoming);
    if (count > 0) result.revisions.push({ month, dataset, count });
  }
}

async function flushMonth(
  month: string,
  byDataset: Map<string, LedgerEntry[]>,
  repository: LedgerRepository,
  result: LedgerUpdateResult,
): Promise<void> {
  if ((await repository.manifest(month))?.sealed)
    return flushSealed(month, byDataset, repository, result);
  for (const [dataset, incoming] of sorted(byDataset)) {
    const merged = mergeLedgerEntries(dataset, [
      ...(await repository.read(month, dataset)),
      ...incoming,
    ]);
    if (await repository.write(month, dataset, merged)) result.changed.push(`${month}/${dataset}`);
  }
  if ((await repository.refreshManifest(month)) && !result.manifests.includes(month))
    result.manifests.push(month);
}

async function flush(pending: Pending, deps: LedgerUpdateDeps, result: LedgerUpdateResult) {
  for (const [month, byDataset] of sorted(pending))
    await flushMonth(month, byDataset, deps.repository, result);
  pending.clear();
}

/**
 * Merges snapshots into the monthly ledger. Every merge rule is commutative and idempotent, so
 * snapshots may arrive in any order, in several batches or more than once: the ledger content
 * only depends on the set of snapshots. Unchanged files are not rewritten.
 */
export async function updateLedger(
  snapshots: Iterable<AuditSnapshot> | AsyncIterable<AuditSnapshot>,
  deps: LedgerUpdateDeps,
): Promise<LedgerUpdateResult> {
  const result: LedgerUpdateResult = {
    snapshots: 0,
    changed: [],
    manifests: [],
    sealed: [],
    revisions: [],
    rejected: {},
    gaps: [],
  };
  const batchSize = Math.max(1, deps.batchSize ?? Number.POSITIVE_INFINITY);
  const pending: Pending = new Map();
  for await (const snapshot of snapshots) {
    addSnapshot(pending, snapshot, deps.hash, result);
    result.snapshots += 1;
    if (result.snapshots % batchSize === 0) await flush(pending, deps, result);
  }
  await flush(pending, deps, result);
  result.sealed.sort();
  result.gaps.sort((a, b) => (gapKey(a) < gapKey(b) ? -1 : gapKey(a) > gapKey(b) ? 1 : 0));
  return result;
}

/** Latest collection time recorded in any month (the point `ledger update` continues from). */
export async function latestLedgerRecord(repository: LedgerRepository): Promise<string | null> {
  let latest: string | null = null;
  for (const month of await repository.months()) {
    const recorded = (await repository.manifest(month))?.lastRecordedAt ?? null;
    if (recorded !== null && (latest === null || recorded > latest)) latest = recorded;
  }
  return latest;
}
