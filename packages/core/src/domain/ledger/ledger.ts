import type { AuditSnapshot } from '../model/snapshot.js';
import { compareText, type LedgerEntry, type LedgerHasher } from './entry.js';
import { ledgerSpecFor } from './datasets.js';
import { LEDGER_KINDS, type LedgerPlacement } from './kinds.js';

type Row = Record<string, unknown>;

export interface LedgerContribution extends LedgerPlacement {
  dataset: string;
}

export interface SnapshotLedgerEntries {
  entries: LedgerContribution[];
  /** Rows per dataset that had no usable time (not recorded). */
  rejected: Record<string, number>;
}

/**
 * The ledger entries one snapshot contributes, each with its month and dataset. Only datasets
 * collected `ok` are recorded: an unavailable or failed dataset is a gap, never an empty state.
 */
export function ledgerEntriesOf(
  snapshot: AuditSnapshot,
  hash: LedgerHasher,
): SnapshotLedgerEntries {
  const result: SnapshotLedgerEntries = { entries: [], rejected: {} };
  for (const [dataset, items] of Object.entries(snapshot.data)) {
    const spec = ledgerSpecFor(dataset);
    const meta = snapshot.coverage[dataset as keyof AuditSnapshot['coverage']];
    if (!spec || !Array.isArray(items) || meta?.status !== 'ok') continue;
    const { placed, rejected } = LEDGER_KINDS[spec.kind].record(items as unknown as Row[], spec, {
      recordedAt: snapshot.collectedAt,
      asOf: meta.asOf ?? snapshot.collectedAt,
      window: meta.window,
      hash,
    });
    for (const placement of placed) result.entries.push({ dataset, ...placement });
    if (rejected > 0) result.rejected[dataset] = rejected;
  }
  return result;
}

/** Normalized content of one month file of `dataset` from stored and new entries (any order). */
export function mergeLedgerEntries(
  dataset: string,
  entries: readonly LedgerEntry[],
): LedgerEntry[] {
  const spec = ledgerSpecFor(dataset);
  if (!spec) throw new Error(`Dataset ${dataset} is not registered for the ledger`);
  return LEDGER_KINDS[spec.kind].merge(entries);
}

export interface LedgerFileSummary {
  count: number;
  /** Earliest and latest time the entries cover (event / daily row time, else the collection). */
  window: { from: string; to: string } | null;
  /** Latest collection time among the entries. */
  lastRecordedAt: string | null;
}

const extremes = (values: readonly string[]): { from: string; to: string } | null => {
  const sorted = [...values].sort(compareText);
  const [from] = sorted;
  const to = sorted.at(-1);
  return from !== undefined && to !== undefined ? { from, to } : null;
};

/** Count, covered window and latest collection of one month file. */
export function summarizeLedgerFile(
  dataset: string,
  entries: readonly LedgerEntry[],
): LedgerFileSummary {
  const spec = ledgerSpecFor(dataset);
  if (!spec) throw new Error(`Dataset ${dataset} is not registered for the ledger`);
  const strategy = LEDGER_KINDS[spec.kind];
  return {
    count: entries.length,
    window: extremes(entries.map((entry) => strategy.timeOf(entry, spec))),
    lastRecordedAt: extremes(entries.map((entry) => entry.recordedAt))?.to ?? null,
  };
}
