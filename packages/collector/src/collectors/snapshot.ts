import { randomUUID } from 'node:crypto';
import { nowISO, type AuditSnapshot } from '@claude-audit/shared';
import type { FileStore } from '../storage/file-store.js';
import type { StateManager } from '../storage/state-manager.js';
import { collectActivities, type ActivitySource } from './audit-collector.js';
import { collectOrg, type OrgSource } from './org-collector.js';

export const COLLECTOR_VERSION = '0.1.0';

export interface SnapshotDeps {
  org: OrgSource;
  activities: ActivitySource | null;
  store: FileStore;
  state: StateManager;
  organizationId?: string | undefined;
}

/** `2026-09-29T06:00:00.000Z` -> `2026-09-29T06-00` (matches BLUEPRINT §6.1 file naming). */
export function snapshotFileName(iso: string): string {
  return `${iso.slice(0, 16).replace(':', '-')}.json`;
}

/**
 * Collects a full snapshot, stores it under snapshots/ and advances the state.
 * State is saved only after the snapshot is written, so a failed run is retried
 * from the same cursor.
 */
export async function collectSnapshot(deps: SnapshotDeps): Promise<AuditSnapshot> {
  const started = Date.now();
  const state = await deps.state.load();

  const [org, audit] = await Promise.all([
    collectOrg(deps.org),
    collectActivities(deps.activities, state.last_activity_id),
  ]);

  const collected_at = nowISO();
  const snapshot: AuditSnapshot = {
    collected_at,
    collection_id: randomUUID(),
    organization_id: deps.organizationId ?? audit.activities[0]?.organization_id ?? 'unknown',
    activities: audit.activities,
    ...org,
    usage: null,
    metadata: {
      collector_version: COLLECTOR_VERSION,
      duration_ms: Date.now() - started,
      activity_count: audit.activities.length,
      sync_type: audit.sync_type,
      last_activity_id: audit.last_activity_id,
    },
  };

  await deps.store.writeJson(`snapshots/${snapshotFileName(collected_at)}`, snapshot);
  await deps.state.save({
    last_collection_at: collected_at,
    last_activity_id: audit.last_activity_id,
    collection_count: state.collection_count + 1,
  });
  return snapshot;
}
