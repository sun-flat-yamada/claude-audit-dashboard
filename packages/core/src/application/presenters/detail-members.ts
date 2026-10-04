import type { DetailMembers } from '../../contracts/detail-view.js';
import { DETAIL_SCHEMA_VERSION } from '../../contracts/detail-view.js';
import type { DatasetMap } from '../../domain/model/dataset.js';
import type { IdentityMasker } from '../../domain/util/mask.js';

export interface DetailMembersInput {
  now: Date;
  data: DatasetMap;
  /** `memberActivity` was collected (otherwise `active` is unknown, not false). */
  activityCollected: boolean;
  inactiveDays: number;
  mask: IdentityMasker;
}

export function buildDetailMembers(input: DetailMembersInput): DetailMembers {
  const { data, mask } = input;
  const activity = new Map(data.memberActivity.map((a) => [a.userId, a]));
  return {
    schemaVersion: DETAIL_SCHEMA_VERSION,
    generatedAt: input.now.toISOString(),
    inactiveDays: input.inactiveDays,
    members: data.members.map((m) => {
      const a = input.activityCollected ? activity.get(m.id) : undefined;
      return {
        id: mask.id('u', m.id),
        email: mask.email(m.email),
        name: mask.name(m.name),
        role: m.role,
        organizationId: m.organizationId,
        joinedAt: m.joinedAt,
        active: input.activityCollected ? (a?.active ?? false) : null,
        lastActiveOn: a?.lastActiveOn ?? null,
      };
    }),
    invites: data.invites.map((i) => ({
      id: mask.id('i', i.id),
      email: mask.email(i.email),
      role: i.role,
      status: i.status,
      invitedAt: i.invitedAt,
      expiresAt: i.expiresAt,
    })),
  };
}
