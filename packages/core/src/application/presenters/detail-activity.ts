import type { DetailActivity } from '../../contracts/detail-view.js';
import { DETAIL_ACTIVITY_MONTH_LIMIT, DETAIL_SCHEMA_VERSION } from '../../contracts/detail-view.js';
import type { Activity } from '../../domain/model/entities.js';
import type { IdentityMasker } from '../../domain/util/mask.js';

const ACTOR_PREFIX: Record<string, string> = { user_actor: 'u', api_actor: 'k' };

const actorView = (mask: IdentityMasker, actor: Activity['actor']) => ({
  kind: actor.kind,
  id: actor.id === null ? null : mask.id(ACTOR_PREFIX[actor.kind] ?? 'a', actor.id),
  email: actor.email === null ? null : mask.email(actor.email),
  ip: mask.ip(actor.ip),
});

/** One file per UTC month, newest first, capped so a single file stays small. */
export function buildDetailActivity(
  now: Date,
  activities: readonly Activity[],
  mask: IdentityMasker,
): DetailActivity[] {
  const byMonth = new Map<string, Activity[]>();
  for (const a of activities) {
    const month = a.createdAt.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), a]);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rows]) => {
      const newest = [...rows].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      );
      return {
        schemaVersion: DETAIL_SCHEMA_VERSION,
        generatedAt: now.toISOString(),
        month,
        total: rows.length,
        truncated: rows.length > DETAIL_ACTIVITY_MONTH_LIMIT,
        items: newest.slice(0, DETAIL_ACTIVITY_MONTH_LIMIT).map((a) => ({
          id: a.id,
          type: a.type,
          createdAt: a.createdAt,
          organizationId: a.organizationId,
          actor: actorView(mask, a.actor),
        })),
      };
    });
}
