export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** `2026-09-30T12:34:56.000Z` -> `2026-09-30` (UTC). */
export const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

/** `2026-09-30T12:34:56.000Z` -> `2026-09` (UTC). */
export const monthKey = (date: Date): string => date.toISOString().slice(0, 7);

export const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);

export const addMinutes = (date: Date, minutes: number): Date =>
  new Date(date.getTime() + minutes * 60_000);

/** Whole days elapsed from `from` to `to` (negative when `from` is later). */
export const daysBetween = (from: string | Date, to: Date): number =>
  Math.floor((to.getTime() - new Date(from).getTime()) / DAY_MS);

export const laterOf = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b);

export const earlierOf = (a: Date, b: Date): Date => (a.getTime() <= b.getTime() ? a : b);

export interface DateRange {
  start: Date;
  end: Date;
}

/** Calendar month `YYYY-MM` as a half-open UTC range [first day, first day of next month). */
export function monthRange(month: string): DateRange {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error(`Invalid month (expected YYYY-MM): ${month}`);
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  return { start: new Date(Date.UTC(year, index, 1)), end: new Date(Date.UTC(year, index + 1, 1)) };
}

export const previousMonth = (date: Date): string =>
  monthKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)));

export const daysInMonth = (date: Date): number =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();

/** Snapshot ids sort chronologically: `2026-09-30T06-00-00Z`. */
export const timestampId = (date: Date): string =>
  `${date.toISOString().slice(0, 19).replaceAll(':', '-')}Z`;
