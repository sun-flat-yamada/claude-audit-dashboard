import { addDays, monthRange } from '../util/time.js';
import { BACKFILL_REVISION_DAYS } from './backfill.js';
import { ledgerSpecFor } from './datasets.js';
import { canonicalJson, compareText, type LedgerEntry, type LedgerKind } from './entry.js';
import { LEDGER_KINDS } from './kinds.js';
import { mergeLedgerEntries } from './ledger.js';
import type { LedgerSealPolicy } from './manifest.js';

/**
 * How `ledger seal` treats each kind (#160 U6). Registry: a new kind adds one entry.
 * - `compare`: the re-fetched month must equal the ledger (keys and row content)
 * - `replace`: the API's calendar-month roll-up becomes the month file (regular collections store
 *   rolling-window roll-ups, which can never equal it)
 * - `keep`: no history in the API, the recorded versions are sealed as they are
 */
export const LEDGER_SEAL_POLICY: Readonly<Record<LedgerKind, LedgerSealPolicy>> = {
  event: 'compare',
  daily: 'compare',
  rollup: 'replace',
  state: 'keep',
};

/** The seal policy of a ledger dataset (`keep` for a name the ledger does not know). */
export const sealPolicyOf = (dataset: string): LedgerSealPolicy => {
  const spec = ledgerSpecFor(dataset);
  return spec ? LEDGER_SEAL_POLICY[spec.kind] : 'keep';
};

/** First instant a month may be sealed: its end plus the Analytics revision period. */
export const sealReadyAt = (month: string): Date =>
  addDays(monthRange(month).end, BACKFILL_REVISION_DAYS);

/** Key and content of an entry without the collection metadata (`recordedAt`, `asOf`, …). */
const signature = (entry: LedgerEntry): string =>
  `${entry.key}\u0000${entry.hash ?? canonicalJson(entry.item)}`;

/** How a re-fetched month differs from the ledger (counts and the affected UTC days). */
export interface LedgerDifference {
  dataset: string;
  /** Rows the API returned that the ledger does not have. */
  missing: number;
  /** Rows the ledger has that the API did not return. */
  extra: number;
  /** Rows with the same key and a different content. */
  changed: number;
  /** `yyyy-mm-dd` of every differing row, sorted, unique. */
  dates: string[];
}

export const hasDifference = (difference: LedgerDifference): boolean =>
  difference.missing + difference.extra + difference.changed > 0;

const byKey = (entries: readonly LedgerEntry[]): Map<string, LedgerEntry> =>
  new Map(entries.map((entry) => [entry.key, entry]));

/**
 * Compares the ledger file of a month with the same month re-fetched from the API. Both sides are
 * normalized with the kind's merge rule first; only keys and row content count. Pure.
 */
export function compareLedgerContent(
  dataset: string,
  stored: readonly LedgerEntry[],
  fetched: readonly LedgerEntry[],
): LedgerDifference {
  const spec = ledgerSpecFor(dataset);
  if (!spec) throw new Error(`Dataset ${dataset} is not registered for the ledger`);
  const strategy = LEDGER_KINDS[spec.kind];
  const ours = byKey(mergeLedgerEntries(dataset, stored));
  const theirs = byKey(mergeLedgerEntries(dataset, fetched));
  const result: LedgerDifference = { dataset, missing: 0, extra: 0, changed: 0, dates: [] };
  const dates = new Set<string>();
  const note = (entry: LedgerEntry) => dates.add(strategy.timeOf(entry, spec).slice(0, 10));
  for (const [key, entry] of theirs) {
    const held = ours.get(key);
    if (!held) result.missing += 1;
    else if (signature(held) !== signature(entry)) result.changed += 1;
    else continue;
    note(entry);
  }
  for (const [key, entry] of ours) {
    if (theirs.has(key)) continue;
    result.extra += 1;
    note(entry);
  }
  result.dates = [...dates].filter((d) => d.length > 0).sort(compareText);
  return result;
}

/**
 * The entries `incoming` would change in the sealed `stored` file: the entries of their merge that
 * `stored` does not hold. They are kept apart (`revisions/`), the sealed file never changes.
 */
export function revisionEntries(
  dataset: string,
  stored: readonly LedgerEntry[],
  incoming: readonly LedgerEntry[],
): LedgerEntry[] {
  const held = new Set(stored.map(signature));
  return mergeLedgerEntries(dataset, [...stored, ...incoming]).filter(
    (entry) => !held.has(signature(entry)),
  );
}
