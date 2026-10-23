import { z } from 'zod';
import type { TimeWindow } from '../model/dataset.js';

/**
 * How a dataset is merged into the monthly ledger (`data/ledger/<yyyy-mm>/`):
 * - `event`: immutable records (Activity Feed), unique by id, the first recorded version is kept
 * - `daily`: daily aggregates, unique by date + breakdown, the version with the newer `asOf` wins
 * - `rollup`: range roll-ups, unique by month + target id, the newest collection overwrites
 * - `state`: current-value datasets, one version of the whole dataset per content change
 */
export type LedgerKind = 'event' | 'daily' | 'rollup' | 'state';

/** One line of a ledger file. `item` is the dataset row (or, for `state`, the whole dataset). */
export interface LedgerEntry {
  /** Unique within the month file; files are sorted by it. */
  key: string;
  /** Collection time of the snapshot that supplied this version (ISO 8601, UTC). */
  recordedAt: string;
  /** `daily`: freshness watermark of the source (dataset `asOf`, else the collection time). */
  asOf?: string;
  /** `state`: the time this version became current (the collection time). */
  validFrom?: string;
  /** `state`: SHA-256 (hex) of the canonical JSON of `item`. */
  hash?: string;
  /** `rollup`: the period the source aggregated over, when it reported one. */
  window?: TimeWindow;
  item: unknown;
}

/** Content hash (hex) of a text. Injected by the outer layer (SHA-256 there); core stays pure. */
export type LedgerHasher = (text: string) => string;

export const ledgerEntrySchema = z.looseObject({
  key: z.string(),
  recordedAt: z.string(),
  asOf: z.string().optional(),
  validFrom: z.string().optional(),
  hash: z.string().optional(),
  window: z.object({ from: z.string(), to: z.string() }).optional(),
  item: z.unknown(),
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Compact JSON with object keys in code-unit order: equal data always gives equal text. */
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    isPlainObject(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => compareText(a, b)))
      : v,
  );

/** JSON Lines: one canonical entry per line, each line terminated by a newline. */
export const serializeLedgerEntries = (entries: readonly LedgerEntry[]): string =>
  entries.map((entry) => `${canonicalJson(entry)}\n`).join('');

/** Parses JSON Lines written by `serializeLedgerEntries`; throws on a malformed line. */
export function parseLedgerEntries(text: string, label: string): LedgerEntry[] {
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const parsed = ledgerEntrySchema.safeParse(JSON.parse(line));
      if (!parsed.success || !('item' in parsed.data)) {
        throw new Error(`Malformed ledger entry ${String(index + 1)} in ${label}`);
      }
      return parsed.data as LedgerEntry;
    });
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])/;

/** `yyyy-mm` (UTC) of an ISO date or timestamp; null when it does not start with one. */
export const ledgerMonthOf = (time: unknown): string | null => {
  if (typeof time !== 'string') return null;
  // A timestamp with an offset belongs to its UTC month; a plain date to its own month.
  const instant = time.length > 10 ? new Date(time) : null;
  const text = instant && !Number.isNaN(instant.getTime()) ? instant.toISOString() : time;
  const match = MONTH.exec(text);
  return match ? `${match[1] ?? ''}-${match[2] ?? ''}` : null;
};

export const LEDGER_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
