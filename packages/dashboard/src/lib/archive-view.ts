import type { ArchiveYear } from '@claude-audit/core/contracts';

const UNITS = ['KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** 1,536 -> `1.5 KB`; below 1 KB the exact byte count. Binary steps (1 KB = 1,024 bytes). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return `${String(Math.round(bytes))} B`;
  let value = bytes / 1024;
  let unit = 0;
  // Step up when rounding would show 1024.0 of the smaller unit.
  while ((Math.round(value * 10) / 10 >= 1024 || value >= 1024) && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${UNITS[unit] ?? 'PB'}`;
}

/** `2026-09-30T06-00-00Z` -> `2026-09-30 06:00 UTC`; anything else is returned as is. */
export function formatSnapshotId(id: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-\d{2}Z$/.exec(id);
  return match ? `${match[1] ?? ''} ${match[2] ?? ''}:${match[3] ?? ''} UTC` : id;
}

/** Share of the archive size held by one year, in percent (0 when the archive is empty). */
export const sizeShare = (bytes: number, totalBytes: number): number =>
  totalBytes > 0 ? (bytes / totalBytes) * 100 : 0;

/** Years whose number or oldest / newest snapshot (id or date) contains the query. */
export function filterYears(years: readonly ArchiveYear[], query: string): ArchiveYear[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...years];
  return years.filter((y) =>
    [y.year, y.oldest, y.newest, formatSnapshotId(y.oldest), formatSnapshotId(y.newest)].some((t) =>
      t.toLowerCase().includes(q),
    ),
  );
}
