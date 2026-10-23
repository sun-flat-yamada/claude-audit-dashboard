import type { LedgerEntry, LedgerHasher } from '../../domain/ledger/entry.js';
import { ledgerEntriesOf, mergeLedgerEntries } from '../../domain/ledger/ledger.js';
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
  /** Sealed months that new data would have touched (left unchanged; revisions are U6). */
  sealed: string[];
  /** Rows per dataset without a usable time (not recorded). */
  rejected: Record<string, number>;
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
}

const sorted = <T>(values: Iterable<[string, T]>): [string, T][] =>
  [...values].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

async function flushMonth(
  month: string,
  byDataset: Map<string, LedgerEntry[]>,
  repository: LedgerRepository,
  result: LedgerUpdateResult,
): Promise<void> {
  if ((await repository.manifest(month))?.sealed) {
    if (!result.sealed.includes(month)) result.sealed.push(month);
    return;
  }
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
    rejected: {},
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
