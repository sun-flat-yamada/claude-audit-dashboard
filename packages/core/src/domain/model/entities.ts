/**
 * Domain entities. They describe the Claude Enterprise tenant in our own words;
 * external field names never leak past the adapters that map API responses into them.
 */

/** A linked organization under the Claude Enterprise parent organization. */
export interface Organization {
  id: string;
  name: string;
  createdAt: string | null;
}

export interface Member {
  id: string;
  email: string;
  name: string;
  /** Built-in organization role as reported by the API (open set, e.g. `owner`, `managed`). */
  role: string;
  /** Null when the source lists members of a single organization. */
  organizationId: string | null;
  joinedAt: string | null;
}

/** Whether a member had counted activity inside the collected analytics window. */
export interface MemberActivity {
  userId: string;
  email: string | null;
  active: boolean;
  /** `YYYY-MM-DD`; absent when the organization has last-activity reporting disabled. */
  lastActiveOn: string | null;
}

export interface Invite {
  id: string;
  email: string;
  role: string;
  status: string;
  invitedAt: string;
  expiresAt: string | null;
}

export interface Group {
  id: string;
  name: string;
  /** `direct` (created in claude.ai) or `scim` (identity provider); open set. */
  source: string;
  roleIds: string[] | null;
  /** Null when member counts could not be collected. */
  memberCount: number | null;
}

export interface SettingValue {
  type: string;
  value: unknown;
}

/** Effective settings of one organization; a missing name means "not controllable there". */
export interface OrgSettings {
  organizationId: string;
  organizationName: string;
  values: Record<string, SettingValue>;
}

/** A key created in claude.ai (Compliance / Analytics / Admin scopes). */
export interface Credential {
  id: string;
  name: string;
  scopes: string[];
  active: boolean;
  createdAt: string;
  expiresAt: string | null;
  createdBy: string | null;
}

/** Last time a credential was observed calling the Compliance API (projection). */
export interface CredentialUsage {
  credentialId: string;
  lastSeenAt: string;
}

export interface ActivityActor {
  /** Raw discriminator, e.g. `user_actor`, `api_actor`, `scim_directory_sync_actor` (open set). */
  kind: string;
  id: string | null;
  email: string | null;
  ip: string | null;
}

export interface Activity {
  id: string;
  type: string;
  createdAt: string;
  organizationId: string | null;
  actor: ActivityActor;
  /** Type-specific fields, e.g. `previous_role` / `current_role`; unknown fields are kept. */
  attributes: Record<string, unknown>;
}

/** Breakdown a usage / cost row belongs to. `total` rows are the ungrouped organization total. */
export type UsageDimension = 'total' | 'product' | 'model' | 'group';

export interface UsageRow {
  /** Bucket start, `YYYY-MM-DD`. */
  date: string;
  dimension: UsageDimension;
  /** Product, model or RBAC group id; null for totals and unattributed usage. */
  key: string | null;
  uncachedInputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
  requests: number | null;
}

export interface CostRow {
  date: string;
  dimension: UsageDimension;
  key: string | null;
  /** Major currency units (dollars for USD), post-discount. */
  amount: number;
  listAmount: number | null;
  currency: string;
}

export interface AdoptionDay {
  date: string;
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
  assignedSeats: number | null;
  monthlyAdoptionRate: number | null;
  pendingInvites: number | null;
}

export interface SpendLimit {
  userId: string;
  email: string | null;
  period: string;
  /** Major units; null means unlimited for this period. */
  limit: number | null;
  spent: number;
  source: string;
  currency: string;
}
