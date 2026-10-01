import type { Coverage, DatasetData } from './dataset.js';

export const SNAPSHOT_SCHEMA_VERSION = 2;

/** One collection run: datasets plus how each of them was obtained. */
export interface AuditSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  id: string;
  collectedAt: string;
  coverage: Coverage;
  data: DatasetData;
}

export type SnapshotHeader = Pick<AuditSnapshot, 'id' | 'collectedAt'>;
