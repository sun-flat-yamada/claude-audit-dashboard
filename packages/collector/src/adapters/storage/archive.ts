import { gzipSync } from 'node:zlib';
import { timestampId } from '@claude-audit/core';
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
