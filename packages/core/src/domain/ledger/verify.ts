import { z } from 'zod';
import { DAY_MS, HOUR_MS, addDays, monthRange, toIsoDate } from '../util/time.js';
import { ledgerSpecFor } from './datasets.js';
import type { LedgerEntry } from './entry.js';
import { LEDGER_KINDS } from './kinds.js';
import type { LedgerManifest } from './manifest.js';

/** What `ledger verify` checks (#160 U6). */
export const LEDGER_CHECKS = ['gap', 'stale', 'digest'] as const;
export type LedgerCheck = (typeof LEDGER_CHECKS)[number];

/** One problem found by `ledger verify`. Months, datasets, dates and counts only (no identities). */
export const ledgerFindingSchema = z.object({
  check: z.enum(LEDGER_CHECKS),
  month: z.string().nullable(),
  dataset: z.string().nullable(),
  message: z.string(),
  /** `gap`: the missing UTC days. */
  dates: z.array(z.string()).optional(),
});

export type LedgerFinding = z.infer<typeof ledgerFindingSchema>;

/** Content hash and entry count of one stored file, as read now. */
export interface LedgerFileDigest {
  dataset: string;
  sha256: string;
  count: number;
  /** SHA-256 of the stored bytes when the file is encrypted (U8). */
  encryptedSha256?: string | undefined;
}

/** At most this many dates are spelled out in a message. */
export const MAX_LISTED_DATES = 10;

export const listDates = (dates: readonly string[]): string =>
  dates.length > MAX_LISTED_DATES
    ? `${dates.slice(0, MAX_LISTED_DATES).join(', ')} and ${String(dates.length - MAX_LISTED_DATES)} more`
    : dates.join(', ');

/** UTC days of `month` in `[from, until)` (both `yyyy-mm-dd`) that are not in `present`. */
export function missingDays(
  month: string,
  present: ReadonlySet<string>,
  from: string,
  until: string,
): string[] {
  const { start, end } = monthRange(month);
  const missing: string[] = [];
  for (let day = start; day.getTime() < end.getTime(); day = addDays(day, 1)) {
    const date = toIsoDate(day);
    if (date >= from && date < until && !present.has(date)) missing.push(date);
  }
  return missing;
}

export interface DayGapInput {
  month: string;
  dataset: string;
  /** Days that have at least one row. */
  present: ReadonlySet<string>;
  /** First day the dataset was ever recorded (earlier days are not a gap). */
  firstDay: string;
  /** First day not expected yet (today minus the publication lag). */
  until: string;
}

/** The missing days of one daily dataset in one month as a finding; null when complete. */
export function dayGapFinding(input: DayGapInput): LedgerFinding | null {
  const dates = missingDays(input.month, input.present, input.firstDay, input.until);
  if (dates.length === 0) return null;
  return {
    check: 'gap',
    month: input.month,
    dataset: input.dataset,
    message: `${input.dataset} ${input.month}: ${String(dates.length)} day(s) without rows: ${listDates(dates)}`,
    dates,
  };
}

/** A finding when the latest recorded collection is older than `maxStaleHours`. */
export function staleFinding(
  lastRecordedAt: string | null,
  now: Date,
  maxStaleHours: number,
): LedgerFinding | null {
  if (lastRecordedAt === null)
    return { check: 'stale', month: null, dataset: null, message: 'No collection is recorded' };
  const hours = (now.getTime() - Date.parse(lastRecordedAt)) / HOUR_MS;
  if (!(hours > maxStaleHours)) return null;
  return {
    check: 'stale',
    month: null,
    dataset: null,
    message: `Last recorded collection ${hours.toFixed(1)}h ago (max ${String(maxStaleHours)}h)`,
  };
}

type Listed = Readonly<
  Record<string, { sha256: string; count: number; encryptedSha256?: string | undefined }>
>;

/** What differs between a listed and a stored file; null when they match. */
function fileDifference(expected: Listed[string], file: LedgerFileDigest): string | null {
  if (file.sha256 !== expected.sha256) return 'content hash differs from MANIFEST.json';
  if (file.count !== expected.count)
    return `${String(file.count)} entries, ${String(expected.count)} listed`;
  if (!expected.encryptedSha256 !== !file.encryptedSha256)
    return file.encryptedSha256
      ? 'stored encrypted, listed as a plain file'
      : 'stored as a plain file, listed as encrypted';
  if (expected.encryptedSha256 !== file.encryptedSha256)
    return 'encrypted file hash differs from MANIFEST.json';
  return null;
}

/** Differences between the listed files (manifest) and the files as read now. */
function compareListed(
  month: string,
  label: string,
  listed: Listed,
  actual: readonly LedgerFileDigest[],
): LedgerFinding[] {
  const finding = (dataset: string, what: string): LedgerFinding => ({
    check: 'digest',
    month,
    dataset,
    message: `${month} ${label}${dataset}: ${what}`,
  });
  const found = new Map(actual.map((file) => [file.dataset, file]));
  const findings: LedgerFinding[] = [];
  for (const [dataset, expected] of Object.entries(listed)) {
    const file = found.get(dataset);
    const difference = file ? fileDifference(expected, file) : 'file missing';
    if (difference) findings.push(finding(dataset, difference));
  }
  for (const file of actual)
    if (!(file.dataset in listed))
      findings.push(finding(file.dataset, 'file not listed in MANIFEST.json'));
  return findings;
}

/** Hash, count and presence of every file and revision file of a sealed month. */
export function digestFindings(
  manifest: LedgerManifest,
  files: readonly LedgerFileDigest[],
  revisions: readonly LedgerFileDigest[],
): LedgerFinding[] {
  return [
    ...compareListed(manifest.month, '', manifest.datasets, files),
    ...compareListed(manifest.month, 'revisions/', manifest.revisions ?? {}, revisions),
  ];
}

/** UTC calendar days from `since` to `now`, both included (a failure seen today counts 1). */
export const failingDays = (since: string, now: Date): number =>
  Math.floor((Date.parse(toIsoDate(now)) - Date.parse(since.slice(0, 10))) / DAY_MS) + 1;

/** UTC days (`yyyy-mm-dd`) the entries of a daily or event dataset cover. */
export function entryDays(dataset: string, entries: readonly LedgerEntry[]): Set<string> {
  const spec = ledgerSpecFor(dataset);
  if (!spec) throw new Error(`Dataset ${dataset} is not registered for the ledger`);
  const strategy = LEDGER_KINDS[spec.kind];
  return new Set(entries.map((entry) => strategy.timeOf(entry, spec).slice(0, 10)));
}
