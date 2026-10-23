import {
  DAY_MS,
  addDays,
  earlierOf,
  laterOf,
  monthKey,
  monthRange,
  startOfUtcDay,
  type DateRange,
} from '../util/time.js';
import { LEDGER_MONTH } from './entry.js';

/**
 * What an API serves of a dataset's past (#159 U5). Both bounds are optional: the Activity Feed
 * has neither (it holds everything since the Compliance API was enabled, for 6 years).
 */
export interface BackfillLimit {
  /** The source has no data before this instant (Enterprise Analytics: 2026-01-01). */
  readonly notBefore?: Date | undefined;
  /** The source serves only the last `retentionDays` days (`usage_report` / `cost_report`: 365). */
  readonly retentionDays?: number | undefined;
}

/** Why part of the requested period is not fetched. */
export type BackfillExclusionReason = 'epoch' | 'retention';

export interface BackfillDatasetLimit {
  readonly dataset: string;
  readonly limit: BackfillLimit;
}

export interface BackfillRequest {
  /** First month, `yyyy-mm` (UTC). */
  from: string;
  /** Last month, `yyyy-mm` (UTC); at most the month of `now`. */
  to: string;
  /** Datasets in the order they are fetched within a month. */
  datasets: readonly BackfillDatasetLimit[];
  now: Date;
}

/** One request period: one dataset over (the servable part of) one month. */
export interface BackfillUnit {
  dataset: string;
  month: string;
  range: DateRange;
}

export interface BackfillExclusion {
  dataset: string;
  range: DateRange;
  reason: BackfillExclusionReason;
}

export interface BackfillPlan {
  months: string[];
  /** Units ordered by month, then by the dataset order of the request. */
  units: BackfillUnit[];
  /** Parts of the requested period the APIs no longer (or never) serve, per dataset. */
  excluded: BackfillExclusion[];
}

/**
 * Analytics values are revised until about a week after the period (BLUEPRINT §6.5); a unit
 * fetched later than this after its end is final and is not fetched again by a re-run.
 */
export const BACKFILL_REVISION_DAYS = 8;

/** The first UTC midnight at or after `date`. */
const ceilUtcDay = (date: Date): Date => {
  const day = startOfUtcDay(date);
  return day.getTime() === date.getTime() ? day : addDays(day, 1);
};

/**
 * Earliest start a retention-bound source accepts: the first whole UTC day inside the last
 * `days` days, so the oldest bucket is never a partial day.
 */
export const retentionStart = (days: number, now: Date): Date => ceilUtcDay(addDays(now, -days));

/** Every month from `from` to `to` (inclusive), oldest first. */
export function backfillMonths(from: string, to: string): string[] {
  for (const [name, value] of [
    ['--from', from],
    ['--to', to],
  ] as const) {
    if (!LEDGER_MONTH.test(value)) throw new Error(`${name} must be a month (yyyy-mm): ${value}`);
  }
  if (from > to) throw new Error(`--from (${from}) is after --to (${to})`);
  const months: string[] = [];
  for (let month = from; month <= to; month = monthKey(monthRange(month).end)) months.push(month);
  return months;
}

interface Bound {
  start: Date;
  reason: BackfillExclusionReason;
}

const boundsOf = (limit: BackfillLimit, now: Date): Bound[] =>
  [
    ...(limit.notBefore ? [{ start: limit.notBefore, reason: 'epoch' as const }] : []),
    ...(limit.retentionDays !== undefined
      ? [{ start: retentionStart(limit.retentionDays, now), reason: 'retention' as const }]
      : []),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());

/** The parts of `span` before each bound, labelled with the bound that excludes them. */
function exclusionsOf(dataset: string, span: DateRange, bounds: readonly Bound[]) {
  const excluded: BackfillExclusion[] = [];
  let cursor = span.start;
  for (const bound of bounds) {
    const end = earlierOf(bound.start, span.end);
    if (end.getTime() > cursor.getTime())
      excluded.push({ dataset, range: { start: cursor, end }, reason: bound.reason });
    cursor = laterOf(cursor, end);
  }
  return excluded;
}

/**
 * Splits the requested months into one unit per month and dataset, truncated to what each API
 * still serves (`notBefore`, `retentionDays`) and to `now`; the cut-off parts are returned as
 * exclusions so the caller can warn about them. Pure: the same request gives the same plan.
 */
export function planBackfill(request: BackfillRequest): BackfillPlan {
  const { now } = request;
  if (request.to > monthKey(now))
    throw new Error(`--to (${request.to}) is after the current month (${monthKey(now)})`);
  const months = backfillMonths(request.from, request.to);
  const span = {
    start: monthRange(request.from).start,
    end: earlierOf(monthRange(request.to).end, now),
  };
  const units: BackfillUnit[] = [];
  const excluded: BackfillExclusion[] = [];
  const earliest = new Map<string, Date>();
  for (const { dataset, limit } of request.datasets) {
    const bounds = boundsOf(limit, now);
    excluded.push(...exclusionsOf(dataset, span, bounds));
    earliest.set(dataset, bounds.at(-1)?.start ?? span.start);
  }
  for (const month of months) {
    const { start, end } = monthRange(month);
    for (const { dataset } of request.datasets) {
      const range = {
        start: laterOf(start, earliest.get(dataset) ?? start),
        end: earlierOf(end, now),
      };
      if (range.start.getTime() < range.end.getTime()) units.push({ dataset, month, range });
    }
  }
  return { months, units, excluded };
}

/** A fetched period that a re-run can skip: it covers `range` and was fetched after revisions ended. */
export interface BackfillRecord {
  from: string;
  to: string;
  completedAt: string;
}

/** True when `record` covers `range` and was completed `BACKFILL_REVISION_DAYS` after its end. */
export function isFinalBackfill(record: BackfillRecord, range: DateRange): boolean {
  const from = Date.parse(record.from);
  const to = Date.parse(record.to);
  const completed = Date.parse(record.completedAt);
  return (
    from <= range.start.getTime() &&
    to >= range.end.getTime() &&
    completed >= to + BACKFILL_REVISION_DAYS * DAY_MS
  );
}

/** `ledger/BACKFILL.json` key of a unit. */
export const backfillUnitKey = (unit: Pick<BackfillUnit, 'month' | 'dataset'>): string =>
  `${unit.month}/${unit.dataset}`;
