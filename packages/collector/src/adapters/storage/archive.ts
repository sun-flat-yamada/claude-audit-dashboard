import { gunzipSync, gzipSync } from 'node:zlib';
import { SNAPSHOT_SCHEMA_VERSION, timestampId, type AuditSnapshot } from '@claude-audit/core';
import { SNAPSHOT_ID } from '@claude-audit/core/contracts';
import { z } from 'zod';
import type { FileStore } from './file-store.js';
import { FsSnapshotRepository } from './repositories.js';

/**
 * Compresses snapshots collected before `cutoff` into `archive/<year>/<id>.json.gz` and
 * removes their directories. Incomplete snapshot directories are removed without archiving.
 */
export async function archiveSnapshots(store: FileStore, cutoff: Date): Promise<string[]> {
  const snapshots = new FsSnapshotRepository(store);
  const last = timestampId(cutoff);
  const archived: string[] = [];
  for (const id of await snapshots.ids()) {
    if (id >= last) break;
    const snapshot = await snapshots.load(id);
    if (snapshot) {
      await store.write(
        `archive/${id.slice(0, 4)}/${id}.json.gz`,
        gzipSync(JSON.stringify(snapshot)),
      );
    }
    await store.remove(`snapshots/${id}`);
    archived.push(id);
  }
  return archived;
}

const archivedSnapshotSchema = z.object({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  id: z.string(),
  collectedAt: z.string(),
  coverage: z.record(z.string(), z.looseObject({ status: z.enum(['ok', 'unavailable', 'error']) })),
  data: z.record(z.string(), z.array(z.unknown())),
});

export interface RestoreResult {
  /** Snapshot ids written to the target. */
  restored: string[];
  /** Snapshot ids left untouched because the target already holds a snapshot with that id. */
  skipped: string[];
}

const YEAR = /^\d{4}$/;
const SUFFIX = '.json.gz';

async function archivedIds(source: FileStore, selector: string): Promise<string[]> {
  if (SNAPSHOT_ID.test(selector)) return [selector];
  if (!YEAR.test(selector)) {
    throw new Error(`Expected a snapshot id (yyyy-mm-ddThh-mm-ssZ) or a year (yyyy): ${selector}`);
  }
  const ids = (await source.list(`archive/${selector}`))
    .filter((e) => !e.directory && e.name.endsWith(SUFFIX))
    .map((e) => e.name.slice(0, -SUFFIX.length))
    .filter((id) => SNAPSHOT_ID.test(id) && id.startsWith(selector));
  if (ids.length === 0) throw new Error(`No archived snapshots for ${selector}`);
  return ids;
}

/** Reads and validates one `archive/<year>/<id>.json.gz`. The id inside must match the name. */
async function readArchived(source: FileStore, id: string): Promise<AuditSnapshot> {
  const bytes = await source.readBytes(`archive/${id.slice(0, 4)}/${id}${SUFFIX}`);
  if (!bytes) throw new Error(`Archived snapshot not found: ${id}`);
  const parsed = archivedSnapshotSchema.safeParse(JSON.parse(gunzipSync(bytes).toString('utf8')));
  if (!parsed.success || parsed.data.id !== id) {
    throw new Error(`Archived snapshot ${id} is not a valid snapshot archive`);
  }
  return parsed.data as unknown as AuditSnapshot;
}

/**
 * Writes archived snapshots (`archive/<year>/<id>.json.gz` of `source`) back to the
 * `snapshots/<id>/` layout of `target`, through the same writer the collector uses, so every
 * dataset file is byte-identical to the one that was archived. The archive is never modified and
 * a snapshot the target already holds is left as it is. `selector` is one snapshot id or a year.
 */
export async function restoreArchive(
  source: FileStore,
  target: FileStore,
  selector: string,
): Promise<RestoreResult> {
  const repository = new FsSnapshotRepository(target);
  const stored = new Set(await repository.ids());
  const result: RestoreResult = { restored: [], skipped: [] };
  for (const id of await archivedIds(source, selector)) {
    const snapshot = await readArchived(source, id);
    if (stored.has(id) && (await repository.load(id))) {
      result.skipped.push(id);
      continue;
    }
    await repository.save(snapshot);
    result.restored.push(id);
  }
  return result;
}
