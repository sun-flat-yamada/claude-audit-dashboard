import type { AuditActivity } from '@claude-audit/shared';

export interface ActivitySource {
  listActivities(afterId?: string): Promise<AuditActivity[]>;
}

export interface AuditData {
  activities: AuditActivity[];
  sync_type: 'incremental' | 'full';
  last_activity_id: string | null;
}

/**
 * Collects activities incrementally from the stored cursor.
 * Without a source (no Compliance key) returns an empty, cursor-preserving result.
 */
export async function collectActivities(
  source: ActivitySource | null,
  lastActivityId: string | null,
): Promise<AuditData> {
  const sync_type = lastActivityId ? 'incremental' : 'full';
  if (!source) return { activities: [], sync_type, last_activity_id: lastActivityId };
  const activities = await source.listActivities(lastActivityId ?? undefined);
  return {
    activities,
    sync_type,
    last_activity_id: activities.at(-1)?.id ?? lastActivityId,
  };
}
