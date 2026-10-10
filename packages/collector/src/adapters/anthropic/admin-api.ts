import type { Group, Invite, Member, SpendLimit } from '@claude-audit/core';
import { MINOR_AMOUNT, minorToMajor } from '@claude-audit/core';
import { z } from 'zod';
import type { HttpClient } from './http-client.js';
import { collectIdPages, collectTokenPages, idPage, parseResponse, tokenPage } from './paginate.js';

const amount = z.string().regex(MINOR_AMOUNT);

const userSchema = z.looseObject({
  id: z.string(),
  email: z.string(),
  name: z.string().nullish(),
  role: z.string(),
  added_at: z.string().nullish(),
});

const inviteSchema = z.looseObject({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.string(),
  invited_at: z.string(),
  expires_at: z.string().nullish(),
});

const rbacGroupSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  source_type: z.string(),
  role_ids: z.array(z.string()).nullish(),
});

const groupMemberSchema = z.looseObject({ user_id: z.string() });

const spendRowSchema = z.looseObject({
  actor: z.looseObject({
    type: z.string(),
    user_id: z.string().nullish(),
    email_address: z.string().nullish(),
  }),
  amount: amount.nullable(),
  currency: z.string(),
  period: z.string(),
  period_to_date_spend: amount,
  source: z.looseObject({ type: z.string() }),
});

const PATHS = {
  users: '/v1/organizations/users',
  invites: '/v1/organizations/invites',
  groups: '/v1/organizations/rbac_groups',
  groupMembers: (id: string) => `/v1/organizations/rbac_groups/${encodeURIComponent(id)}/members`,
  spendLimits: '/v1/organizations/spend_limits/effective',
};

/**
 * Admin API endpoints available to Claude Enterprise keys: user management
 * (`read:members`, `read:rbac_groups`) and spend limits (`read:spend_limits`).
 */
export class AdminApi {
  constructor(private readonly http: HttpClient) {}

  async listMembers(): Promise<Member[]> {
    const rows = await collectIdPages(async (afterId) =>
      parseResponse(
        idPage(userSchema),
        await this.http.getJson(PATHS.users, { limit: 1000, after_id: afterId }),
        PATHS.users,
      ),
    );
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name ?? u.email,
      role: u.role,
      organizationId: null,
      joinedAt: u.added_at ?? null,
    }));
  }

  async listInvites(): Promise<Invite[]> {
    const rows = await collectIdPages(async (afterId) =>
      parseResponse(
        idPage(inviteSchema),
        await this.http.getJson(PATHS.invites, {
          limit: 1000,
          after_id: afterId,
          statuses: ['pending'],
        }),
        PATHS.invites,
      ),
    );
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      status: i.status,
      invitedAt: i.invited_at,
      expiresAt: i.expires_at ?? null,
    }));
  }

  private async listMemberIds(groupId: string): Promise<string[]> {
    const path = PATHS.groupMembers(groupId);
    const rows = await collectTokenPages(async (page) =>
      parseResponse(
        tokenPage(groupMemberSchema),
        await this.http.getJson(path, { limit: 1000, page }),
        path,
      ),
    );
    return rows.map((r) => r.user_id);
  }

  /** Groups with member counts and member IDs for the first `maxMemberRequests` groups (one request each). */
  async listGroups(maxMemberRequests: number): Promise<Group[]> {
    const rows = await collectTokenPages(async (page) =>
      parseResponse(
        tokenPage(rbacGroupSchema),
        await this.http.getJson(PATHS.groups, { limit: 1000, page }),
        PATHS.groups,
      ),
    );
    const groups: Group[] = [];
    for (const [index, g] of rows.entries()) {
      const memberIds = index < maxMemberRequests ? await this.listMemberIds(g.id) : null;
      groups.push({
        id: g.id,
        name: g.name,
        source: g.source_type,
        roleIds: g.role_ids ?? null,
        memberCount: memberIds !== null ? memberIds.length : null,
        memberIds,
      });
    }
    return groups;
  }

  /** Every member's effective limit per period; rows for API-key actors are skipped. */
  async listSpendLimits(): Promise<SpendLimit[]> {
    const rows = await collectTokenPages(async (page) =>
      parseResponse(
        tokenPage(spendRowSchema),
        await this.http.getJson(PATHS.spendLimits, { limit: 1000, page }),
        PATHS.spendLimits,
      ),
    );
    return rows.flatMap((r) =>
      r.actor.type === 'user_actor' && r.actor.user_id
        ? [
            {
              userId: r.actor.user_id,
              email: r.actor.email_address ?? null,
              period: r.period,
              limit: r.amount === null ? null : minorToMajor(r.amount),
              spent: minorToMajor(r.period_to_date_spend),
              source: r.source.type,
              currency: r.currency,
            },
          ]
        : [],
    );
  }
}
