import type { TimeWindow } from '../model/dataset.js';
import {
  canonicalJson,
  compareText,
  ledgerMonthOf,
  type LedgerEntry,
  type LedgerHasher,
  type LedgerKind,
} from './entry.js';

type Row = Record<string, unknown>;

/** Builds the unique key (or reads the time) of one dataset row. */
export type LedgerKeyFn = (item: Row) => string;

/** How one dataset is recorded: its kind, plus the key and time of a row where the kind needs them. */
export interface LedgerDatasetSpec {
  readonly kind: LedgerKind;
  /** Unique key of a row (`event`, `daily`, `rollup`); default: the row's `id`. */
  readonly key?: LedgerKeyFn;
  /** Time that files a row into a month (`event`, `daily`); default: the row's `date`. */
  readonly time?: LedgerKeyFn;
}

/** What one collection run contributes to the ledger. */
export interface LedgerRecordContext {
  /** Collection time of the snapshot. */
  recordedAt: string;
  /** Freshness watermark of the dataset (its `asOf`, else the collection time). */
  asOf: string;
  /** Period the dataset covers, when the source reported one. */
  window?: TimeWindow | undefined;
  hash: LedgerHasher;
}

export interface LedgerPlacement {
  month: string;
  entry: LedgerEntry;
}

export interface LedgerRecordResult {
  placed: LedgerPlacement[];
  /** Rows without a usable time (no month to file them under). */
  rejected: number;
}

/**
 * One merge rule. `merge` takes the stored entries and the new ones of a month file in any order
 * and returns the normalized file content: commutative and idempotent, so re-runs, batches and
 * later backfills give the same result whatever the order.
 */
export interface LedgerKindStrategy {
  readonly kind: LedgerKind;
  record(
    items: readonly Row[],
    spec: LedgerDatasetSpec,
    context: LedgerRecordContext,
  ): LedgerRecordResult;
  merge(entries: readonly LedgerEntry[]): LedgerEntry[];
  /** The time an entry covers (used for the manifest window). */
  timeOf(entry: LedgerEntry, spec: LedgerDatasetSpec): string;
}

const idKey: LedgerKeyFn = (item) => String(item.id ?? '');
const dateTime: LedgerKeyFn = (item) => String(item.date ?? '');

/** Total order used to break ties, so the winner never depends on the input order. */
const byContent = (a: LedgerEntry, b: LedgerEntry): number =>
  compareText(canonicalJson(a), canonicalJson(b));

/** Keeps one entry per key (`wins(a, b)` true when `a` beats `b`) and sorts by key. */
function mergeKeyed(
  entries: readonly LedgerEntry[],
  wins: (a: LedgerEntry, b: LedgerEntry) => boolean,
): LedgerEntry[] {
  const byKey = new Map<string, LedgerEntry>();
  for (const entry of entries) {
    const held = byKey.get(entry.key);
    if (!held || wins(entry, held)) byKey.set(entry.key, entry);
  }
  return [...byKey.values()].sort((a, b) => compareText(a.key, b.key));
}

/** `order(a, b)` > 0 means `a` wins; equal entries fall back to the content order. */
const winsBy =
  (order: (a: LedgerEntry, b: LedgerEntry) => number) =>
  (a: LedgerEntry, b: LedgerEntry): boolean =>
    (order(a, b) || byContent(a, b)) > 0;

/** Rows keyed by `spec.key`, filed under the month of `month(item)`. */
function recordRows(
  items: readonly Row[],
  month: (item: Row) => string | null,
  entry: (item: Row) => LedgerEntry,
): LedgerRecordResult {
  const result: LedgerRecordResult = { placed: [], rejected: 0 };
  for (const item of items) {
    const at = month(item);
    if (at) result.placed.push({ month: at, entry: entry(item) });
    else result.rejected += 1;
  }
  return result;
}

const eventKind: LedgerKindStrategy = {
  kind: 'event',
  record: (items, spec, { recordedAt }) =>
    recordRows(
      items,
      (item) => ledgerMonthOf((spec.time ?? dateTime)(item)),
      (item) => ({ key: (spec.key ?? idKey)(item), recordedAt, item }),
    ),
  // The first recorded version is kept (the feed is at-least-once; later copies are duplicates).
  merge: (entries) =>
    mergeKeyed(
      entries,
      winsBy((a, b) => compareText(b.recordedAt, a.recordedAt)),
    ),
  timeOf: (entry, spec) => (spec.time ?? dateTime)(entry.item as Row),
};

const dailyKind: LedgerKindStrategy = {
  kind: 'daily',
  record: (items, spec, { recordedAt, asOf }) =>
    recordRows(
      items,
      (item) => ledgerMonthOf((spec.time ?? dateTime)(item)),
      (item) => ({ key: (spec.key ?? idKey)(item), recordedAt, asOf, item }),
    ),
  // Values are revised until about a week after the month: the newer watermark wins.
  merge: (entries) =>
    mergeKeyed(
      entries,
      winsBy(
        (a, b) =>
          compareText(a.asOf ?? a.recordedAt, b.asOf ?? b.recordedAt) ||
          compareText(a.recordedAt, b.recordedAt),
      ),
    ),
  timeOf: (entry, spec) => (spec.time ?? dateTime)(entry.item as Row),
};

const rollupKind: LedgerKindStrategy = {
  kind: 'rollup',
  record: (items, spec, { recordedAt, window }) =>
    recordRows(
      items,
      () => ledgerMonthOf(recordedAt),
      (item) => ({
        key: (spec.key ?? idKey)(item),
        recordedAt,
        ...(window ? { window: { from: window.from, to: window.to } } : {}),
        item,
      }),
    ),
  // The latest roll-up of the month replaces the earlier ones.
  merge: (entries) =>
    mergeKeyed(
      entries,
      winsBy((a, b) => compareText(a.recordedAt, b.recordedAt)),
    ),
  timeOf: (entry) => entry.recordedAt,
};

/** Versions in time order; a version equal to the one before it is not a change and is dropped. */
function mergeVersions(entries: readonly LedgerEntry[]): LedgerEntry[] {
  const ordered = [...entries].sort(
    (a, b) => compareText(a.validFrom ?? a.key, b.validFrom ?? b.key) || byContent(a, b),
  );
  const kept: LedgerEntry[] = [];
  for (const entry of ordered) {
    const last = kept.at(-1);
    if (!last || last.hash !== entry.hash) kept.push(entry);
  }
  return kept;
}

const stateKind: LedgerKindStrategy = {
  kind: 'state',
  record(items, _spec, { recordedAt, hash }) {
    const month = ledgerMonthOf(recordedAt);
    if (!month) return { placed: [], rejected: items.length };
    // Canonical row order: a reordered API response is not a new version.
    const item = items
      .map((row) => ({ row, text: canonicalJson(row) }))
      .sort((a, b) => compareText(a.text, b.text))
      .map(({ row }) => row);
    const entry = {
      key: recordedAt,
      recordedAt,
      validFrom: recordedAt,
      hash: hash(canonicalJson(item)),
      item,
    };
    return { placed: [{ month, entry }], rejected: 0 };
  },
  merge: mergeVersions,
  timeOf: (entry) => entry.validFrom ?? entry.recordedAt,
};

/** The merge rule of every kind; adding a kind is one entry here (no switch on kinds). */
export const LEDGER_KINDS: Readonly<Record<LedgerKind, LedgerKindStrategy>> = {
  event: eventKind,
  daily: dailyKind,
  rollup: rollupKind,
  state: stateKind,
};
