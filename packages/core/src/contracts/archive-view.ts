import { z } from 'zod';
import { DETAIL_DIR } from './detail-view.js';

/**
 * Archive inventory (F-013): what `pnpm archive` moved to `archive/<year>/<id>.json.gz`, as an
 * aggregate per year (snapshot count, compressed bytes, oldest / newest snapshot id) plus totals
 * and the retention setting. Only snapshot ids, years, counts and byte sizes can be represented:
 * ids are validated by shape and no file name, path or content is ever carried. Listed in the
 * detail manifest (`kind: archive`) and published under the detail publication condition. Bump
 * `ARCHIVE_VIEW_SCHEMA_VERSION` on breaking changes.
 */
export const ARCHIVE_VIEW_SCHEMA_VERSION = 1 as const;

export const DETAIL_ARCHIVE_PATH = `${DETAIL_DIR}/archive.json`;

/** `2026-09-30T06-00-00Z` (see `timestampId`). */
export const SNAPSHOT_ID = /^\d{4}-(?:0[1-9]|1[0-2])-\d{2}T\d{2}-\d{2}-\d{2}Z$/;

const snapshotId = z.string().regex(SNAPSHOT_ID);
const count = z.number().int().nonnegative();
const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const yearRow = z.object({
  year: z.string().regex(/^\d{4}$/),
  snapshots: count,
  /** Sum of the compressed file sizes. */
  bytes,
  oldest: snapshotId,
  newest: snapshotId,
});

export const detailArchiveSchema = z.object({
  schemaVersion: z.literal(ARCHIVE_VIEW_SCHEMA_VERSION),
  generatedAt: z.string(),
  /** `retention.snapshotDays`: snapshots older than this are moved to the archive. */
  snapshotDays: z.number().int().positive(),
  /** Newest year first. */
  years: z.array(yearRow),
  totals: z.object({
    snapshots: count,
    bytes,
    years: count,
    oldest: snapshotId.nullable(),
    newest: snapshotId.nullable(),
  }),
  /** Entries in the archive directory that are not `<snapshot id>.json.gz` (not named here). */
  ignoredEntries: count,
});

export type ArchiveYear = z.infer<typeof yearRow>;
export type DetailArchive = z.infer<typeof detailArchiveSchema>;
