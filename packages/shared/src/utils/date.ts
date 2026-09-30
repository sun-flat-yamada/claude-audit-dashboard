/**
 * Date utility functions
 */

/** Get the current ISO 8601 timestamp */
export function nowISO(): string {
  return new Date().toISOString();
}

/** Calculate days elapsed since a given ISO date string */
export function daysSince(isoDate: string): number {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

/** Check if a date is older than N days */
export function isOlderThanDays(isoDate: string, days: number): boolean {
  return daysSince(isoDate) > days;
}

/** Format a date as YYYY-MM-DD */
export function formatDate(isoDate: string): string {
  return isoDate.slice(0, 10);
}

/** Get the start of the current month as ISO string */
export function startOfMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/** Get a date N hours ago as ISO string */
export function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}
