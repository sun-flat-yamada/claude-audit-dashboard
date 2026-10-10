import type {
  Activity,
  ActivityWindow,
  Credential,
  Group,
  Member,
  OrgSettings,
  Organization,
} from '@claude-audit/core';
import { uniqueBy } from '@claude-audit/core';
import { z } from 'zod';
import type { HttpClient } from './http-client.js';
import { collectIdPages, collectTokenPages, idPage, parseResponse, tokenPage } from './paginate.js';

// ─── Response schemas (tolerant: only the fields we use are validated) ──────

const actorSchema = z.looseObject({
  type: z.string(),
  user_id: z.string().nullish(),
  api_key_id: z.string().nullish(),
  admin_api_key_id: z.string().nullish(),
  directory_id: z.string().nullish(),
  service: z.string().nullish(),
  email_address: z.string().nullish(),
  unauthenticated_email_address: z.string().nullish(),
  ip_address: z.string().nullish(),
});

const activitySchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  created_at: z.string(),
  organization_id: z.string().nullish(),
  organization_uuid: z.string().nullish(),
  actor: actorSchema,
});

const organizationSchema = z.looseObject({
  uuid: z.string(),
  name: z.string(),
  created_at: z.string().nullish(),
});

const settingRowSchema = z.looseObject({
  name: z.string().optional(),
  type: z.string().optional(),
  value: z.unknown(),
});

const apiKeySchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  is_active: z.boolean(),
  created_at: z.string(),
  expires_at: z.string().nullish(),
  created_by_id: z.string().nullish(),
});

const settingsSchema = z.looseObject({
  organization_id: z.string(),
  settings: z.array(settingRowSchema),
  api_keys: z.array(apiKeySchema).default([]),
});

const groupSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  source_type: z.string(),
  roles: z.array(z.string()).nullish(),
});

const orgUserSchema = z.looseObject({
  id: z.string(),
  email: z.string(),
  full_name: z.string().nullish(),
  organization_role: z.string(),
});

type RawActivity = z.output<typeof activitySchema>;
type RawSettings = z.output<typeof settingsSchema>;

// ─── Mappers ────────────────────────────────────────────────────────────────

const ACTIVITY_ENVELOPE = new Set([
  'id',
  'type',
  'created_at',
  'organization_id',
  'organization_uuid',
  'actor',
]);

const firstOf = (...values: (string | null | undefined)[]): string | null =>
  values.find((v): v is string => typeof v === 'string') ?? null;

/** Normalizes the discriminated `actor` union; unknown actor types keep their `type`. */
const toActor = (actor: RawActivity['actor']): Activity['actor'] => ({
  kind: actor.type,
  id: firstOf(
    actor.user_id,
    actor.api_key_id,
    actor.admin_api_key_id,
    actor.directory_id,
    actor.service,
  ),
  email: firstOf(actor.email_address, actor.unauthenticated_email_address),
  ip: firstOf(actor.ip_address),
});

export const toActivity = (raw: RawActivity): Activity => ({
  id: raw.id,
  type: raw.type,
  createdAt: raw.created_at,
  organizationId: firstOf(raw.organization_uuid, raw.organization_id),
  actor: toActor(raw.actor),
  attributes: Object.fromEntries(
    Object.entries(raw).filter(([key]) => !ACTIVITY_ENVELOPE.has(key)),
  ),
});

/** Rows whose `name` is implied by their type in the API reference. */
const IMPLIED_SETTING_NAMES: Readonly<Record<string, string>> = {
  provisioning_mode: 'sso_provisioning_mode',
  data_retention: 'data_retention_periods',
};

export function toOrgSettings(org: Organization, raw: RawSettings): OrgSettings {
  const values: OrgSettings['values'] = {};
  for (const row of raw.settings) {
    const name = row.name ?? (row.type ? IMPLIED_SETTING_NAMES[row.type] : undefined);
    if (name) values[name] = { type: row.type ?? 'unknown', value: row.value };
  }
  return { organizationId: org.id, organizationName: org.name, values };
}

const toCredential = (raw: z.output<typeof apiKeySchema>): Credential => ({
  id: raw.id,
  name: raw.name,
  scopes: raw.scopes,
  active: raw.is_active,
  createdAt: raw.created_at,
  expiresAt: raw.expires_at ?? null,
  createdBy: raw.created_by_id ?? null,
});

// ─── Gateway ────────────────────────────────────────────────────────────────

export interface ActivityQuery {
  pageSize: number;
  includeTypes: readonly string[];
  excludeTypes: readonly string[];
}

const PATHS = {
  activities: '/v1/compliance/activities',
  organizations: '/v1/compliance/organizations',
  groups: '/v1/compliance/groups',
  settings: (org: string) => `/v1/compliance/organizations/${encodeURIComponent(org)}/settings`,
  users: (org: string) => `/v1/compliance/organizations/${encodeURIComponent(org)}/users`,
};

/** Compliance API (`/v1/compliance/*`). One method per endpoint; results are memoized per run. */
export class ComplianceApi {
  private organizations: Promise<Organization[]> | undefined;
  private readonly settings = new Map<string, Promise<RawSettings>>();

  constructor(private readonly http: HttpClient) {}

  /**
   * Window polling; `include` and `exclude` filters are mutually exclusive. The feed returns
   * newest first (no sort parameter is documented), so callers must not rely on result order.
   */
  listActivities(window: ActivityWindow, query: ActivityQuery): Promise<Activity[]> {
    const filter = query.includeTypes.length
      ? { activity_types: query.includeTypes }
      : { exclude_activity_types: query.excludeTypes };
    return collectIdPages(async (afterId) =>
      parseResponse(
        idPage(activitySchema),
        await this.http.getJson(PATHS.activities, {
          created_at: { gte: window.from.toISOString(), lt: window.to.toISOString() },
          limit: query.pageSize,
          after_id: afterId,
          ...filter,
        }),
        PATHS.activities,
      ),
    ).then((rows) => rows.map(toActivity));
  }

  listOrganizations(): Promise<Organization[]> {
    this.organizations ??= collectTokenPages(async (page) =>
      parseResponse(
        tokenPage(organizationSchema),
        await this.http.getJson(PATHS.organizations, { limit: 1000, page }),
        PATHS.organizations,
      ),
    ).then((rows) =>
      rows.map((o) => ({ id: o.uuid, name: o.name, createdAt: o.created_at ?? null })),
    );
    return this.organizations;
  }

  private rawSettings(org: string): Promise<RawSettings> {
    let pending = this.settings.get(org);
    if (!pending) {
      const path = PATHS.settings(org);
      pending = this.http.getJson(path).then((body) => parseResponse(settingsSchema, body, path));
      this.settings.set(org, pending);
    }
    return pending;
  }

  async listSettings(): Promise<OrgSettings[]> {
    const orgs = await this.listOrganizations();
    return Promise.all(orgs.map(async (org) => toOrgSettings(org, await this.rawSettings(org.id))));
  }

  /** The key inventory is hierarchy-wide: every organization returns the same list. */
  async listCredentials(): Promise<Credential[]> {
    const orgs = await this.listOrganizations();
    const all = await Promise.all(orgs.map((org) => this.rawSettings(org.id)));
    return uniqueBy(all.flatMap((s) => s.api_keys).map(toCredential), (c) => c.id);
  }

  /** Group metadata only: member lists need `read:compliance_user_data`, which we do not request. */
  listGroups(): Promise<Group[]> {
    return collectTokenPages(async (page) =>
      parseResponse(
        tokenPage(groupSchema),
        await this.http.getJson(PATHS.groups, { limit: 1000, page }),
        PATHS.groups,
      ),
    ).then((rows) =>
      rows.map((g) => ({
        id: g.id,
        name: g.name,
        source: g.source_type,
        roleIds: g.roles ?? null,
        memberCount: null,
        memberIds: null,
      })),
    );
  }

  /** Per-organization directory (requires `read:compliance_user_data`; opt-in fallback only). */
  async listDirectoryMembers(): Promise<Member[]> {
    const orgs = await this.listOrganizations();
    const perOrg = await Promise.all(
      orgs.map(async (org) => {
        const path = PATHS.users(org.id);
        const rows = await collectTokenPages(async (page) =>
          parseResponse(
            tokenPage(orgUserSchema),
            await this.http.getJson(path, { limit: 1000, page }),
            path,
          ),
        );
        return rows.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.full_name ?? u.email,
          role: u.organization_role,
          organizationId: org.id,
          joinedAt: null,
        }));
      }),
    );
    return perOrg.flat();
  }
}
