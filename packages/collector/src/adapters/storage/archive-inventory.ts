import {
  summarizeArchiveEntries,
  type ArchiveEntry,
  type ArchiveSummary,
} from '@claude-audit/core';
import type { Entry } from './file-store.js';

/** The part of the data directory the inventory needs (satisfied by `FileStore`). */
export interface ArchiveListing {
  list(relDir: string): Promise<Entry[]>;
  size(relPath: string): Promise<number>;
}

const ARCHIVE_DIR = 'archive';
const YEAR = /^\d{4}$/;

async function yearEntries(store: ArchiveListing, year: string): Promise<ArchiveEntry[]> {
  const files = await store.list(`${ARCHIVE_DIR}/${year}`);
  return Promise.all(
    files.map(async (f) => ({
      dir: year,
      name: f.name,
      // Sub-directories are not archive files; they are reported with no size and ignored.
      bytes: f.directory ? -1 : await store.size(`${ARCHIVE_DIR}/${year}/${f.name}`),
    })),
  );
}

/**
 * Lists `archive/<year>/*` as raw entries (year directory, file name, compressed size). Entries
 * outside year directories are returned too (with `dir: ''`) so the pure aggregation can count
 * them as ignored. An archive that does not exist yet lists as empty.
 */
export async function listArchiveEntries(store: ArchiveListing): Promise<ArchiveEntry[]> {
  const root = await store.list(ARCHIVE_DIR);
  const nested = await Promise.all(
    root.map(async (e): Promise<ArchiveEntry[]> =>
      e.directory && YEAR.test(e.name)
        ? yearEntries(store, e.name)
        : [{ dir: '', name: e.name, bytes: -1 }],
    ),
  );
  return nested.flat();
}

/** Inventory of the archive by year; shared with the capacity measurement (B3). */
export async function summarizeArchive(store: ArchiveListing): Promise<ArchiveSummary> {
  return summarizeArchiveEntries(await listArchiveEntries(store));
}
