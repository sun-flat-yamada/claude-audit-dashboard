import {
  ARCHIVE_VIEW_SCHEMA_VERSION,
  SNAPSHOT_ID,
  type ArchiveYear,
  type DetailArchive,
} from '../../contracts/archive-view.js';

/** One listed archive file, as found on disk: year directory, file name and compressed size. */
export interface ArchiveEntry {
  /** Directory below `archive/` (`''` for an entry directly in `archive/`). */
  dir: string;
  name: string;
  bytes: number;
}

export interface ArchiveSummary {
  years: ArchiveYear[];
  totals: DetailArchive['totals'];
  ignoredEntries: number;
}

const SUFFIX = '.json.gz';

/** The snapshot id of `<year>/<id>.json.gz`, or null for anything else (incl. a wrong year). */
function snapshotIdOf(entry: ArchiveEntry): string | null {
  if (!entry.name.endsWith(SUFFIX)) return null;
  const id = entry.name.slice(0, -SUFFIX.length);
  const sized = Number.isSafeInteger(entry.bytes) && entry.bytes >= 0;
  return sized && SNAPSHOT_ID.test(id) && id.slice(0, 4) === entry.dir ? id : null;
}

/**
 * The snapshot ids of the valid `<year>/<id>.json.gz` entries, newest first, each once. Entries
 * that `summarizeArchiveEntries` ignores are ignored here too (F-015 lists these ids as
 * `archived` compare points).
 */
export function archivedSnapshotIds(entries: readonly ArchiveEntry[]): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    const id = snapshotIdOf(entry);
    if (id !== null) ids.add(id);
  }
  return [...ids].sort().reverse();
}

const min = (a: string, b: string): string => (a < b ? a : b);
const max = (a: string, b: string): string => (a > b ? a : b);

function addToYear(years: Map<string, ArchiveYear>, id: string, bytes: number): void {
  const year = id.slice(0, 4);
  const row = years.get(year);
  years.set(
    year,
    row
      ? {
          year,
          snapshots: row.snapshots + 1,
          bytes: row.bytes + bytes,
          oldest: min(row.oldest, id),
          newest: max(row.newest, id),
        }
      : { year, snapshots: 1, bytes, oldest: id, newest: id },
  );
}

/**
 * Aggregates archive entries by year. Pure and order-independent; entries that are not
 * `<year>/<snapshot id>.json.gz` (or whose id disagrees with the year directory, or whose size
 * is not a non-negative integer) are ignored and only counted. A repeated id counts once (the
 * larger size is kept), so a listing that overlaps itself cannot inflate the totals. Shared by
 * the inventory view and the capacity measurement (B3).
 */
export function summarizeArchiveEntries(entries: readonly ArchiveEntry[]): ArchiveSummary {
  const sizes = new Map<string, number>();
  let ignored = 0;
  for (const entry of entries) {
    const id = snapshotIdOf(entry);
    if (id === null) ignored += 1;
    else sizes.set(id, Math.max(sizes.get(id) ?? 0, entry.bytes));
  }
  const years = new Map<string, ArchiveYear>();
  for (const [id, bytes] of sizes) addToYear(years, id, bytes);
  const rows = [...years.values()].sort((a, b) => (a.year < b.year ? 1 : a.year > b.year ? -1 : 0));
  const oldest = rows.reduce<string | null>(
    (m, r) => (m === null ? r.oldest : min(m, r.oldest)),
    null,
  );
  const newest = rows.reduce<string | null>(
    (m, r) => (m === null ? r.newest : max(m, r.newest)),
    null,
  );
  return {
    years: rows,
    totals: {
      snapshots: rows.reduce((sum, r) => sum + r.snapshots, 0),
      bytes: rows.reduce((sum, r) => sum + r.bytes, 0),
      years: rows.length,
      oldest,
      newest,
    },
    ignoredEntries: ignored,
  };
}

export interface ArchiveViewInput {
  now: Date;
  snapshotDays: number;
  entries: readonly ArchiveEntry[];
}

/** The `detail/archive.json` document. */
export function buildArchiveView(input: ArchiveViewInput): DetailArchive {
  return {
    schemaVersion: ARCHIVE_VIEW_SCHEMA_VERSION,
    generatedAt: input.now.toISOString(),
    snapshotDays: input.snapshotDays,
    ...summarizeArchiveEntries(input.entries),
  };
}
