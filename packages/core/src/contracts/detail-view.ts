import { z } from 'zod';

/**
 * Per-person detail files, published separately from the aggregate-only `dashboard.json`:
 * a manifest (`detail/index.json`) plus one file per entity, each with its own `schemaVersion`.
 * Identifiers are stable short hashes and e-mail addresses / names are masked while the
 * manifest says `maskPii: true`. Bump `DETAIL_SCHEMA_VERSION` on breaking changes.
 */
export const DETAIL_SCHEMA_VERSION = 2;

export const DETAIL_DIR = 'detail';
export const DETAIL_MANIFEST_PATH = `${DETAIL_DIR}/index.json`;
export const DETAIL_MEMBERS_PATH = `${DETAIL_DIR}/members.json`;
export const DETAIL_API_KEYS_PATH = `${DETAIL_DIR}/api-keys.json`;
export const DETAIL_ORG_GROUPS_PATH = `${DETAIL_DIR}/org-groups.json`;
export const detailActivityPath = (month: string): string => `${DETAIL_DIR}/activity-${month}.json`;

/** Most activity rows kept per month file (newest first); `total` always holds the real count. */
export const DETAIL_ACTIVITY_MONTH_LIMIT = 2000;

const version = z.literal(DETAIL_SCHEMA_VERSION);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const header = {
  schemaVersion: version,
  generatedAt: z.string(),
};

export const DETAIL_KINDS = [
  'members',
  'api-keys',
  'activity',
  'org-groups',
  'config',
  'archive',
  'alerts',
] as const;
export type DetailKind = (typeof DETAIL_KINDS)[number];

const manifestFile = z.object({
  kind: z.enum(DETAIL_KINDS),
  /** Relative to the data directory, e.g. `detail/members.json`. */
  path: z.string(),
  /** Version of that file's own contract (each detail file versions independently). */
  schemaVersion: z.number().int().positive(),
  /** `unavailable` entries have no file: the dataset was not collected. */
  status: z.enum(['ok', 'unavailable']),
  reason: z.string().nullable(),
  count: z.number().int().nullable(),
  /** `yyyy-mm`, activity files only. */
  month: month.nullable(),
});

export const detailManifestSchema = z.object({
  ...header,
  collectedAt: z.string().nullable(),
  source: z.enum(['live', 'demo']),
  maskPii: z.boolean(),
  files: z.array(manifestFile),
});

export const detailMembersSchema = z.object({
  ...header,
  /** AC-001 threshold in effect when the file was built. */
  inactiveDays: z.number().int(),
  members: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      role: z.string(),
      organizationId: z.string().nullable(),
      joinedAt: z.string().nullable(),
      /** Null when member activity was not collected. */
      active: z.boolean().nullable(),
      lastActiveOn: z.string().nullable(),
    }),
  ),
  invites: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      role: z.string(),
      status: z.string(),
      invitedAt: z.string(),
      expiresAt: z.string().nullable(),
    }),
  ),
});

export const detailApiKeysSchema = z.object({
  ...header,
  /** AK-001 / AK-003 thresholds in effect when the file was built. */
  unusedDays: z.number().int(),
  maxAgeDays: z.number().int(),
  /** Start of the key-usage observation window; earlier use cannot be known. */
  usageObservedFrom: z.string().nullable(),
  keys: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      scopes: z.array(z.string()),
      active: z.boolean(),
      createdAt: z.string(),
      expiresAt: z.string().nullable(),
      createdBy: z.string().nullable(),
      lastSeenAt: z.string().nullable(),
    }),
  ),
});

export const detailActivitySchema = z.object({
  ...header,
  month,
  /** Real number of activities in the month; `items` is capped at DETAIL_ACTIVITY_MONTH_LIMIT. */
  total: z.number().int(),
  truncated: z.boolean(),
  items: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      createdAt: z.string(),
      organizationId: z.string().nullable(),
      actor: z.object({
        kind: z.string(),
        id: z.string().nullable(),
        email: z.string().nullable(),
        ip: z.string().nullable(),
      }),
    }),
  ),
});

export const detailOrgGroupsSchema = z.object({
  ...header,
  currency: z.string(),
  organizations: z.array(
    z.object({ id: z.string(), name: z.string(), memberCount: z.number().int().nullable() }),
  ),
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      source: z.string(),
      memberCount: z.number().int().nullable(),
      /** Month-to-date spend attributed to the group; groups overlap, so do not sum them. */
      monthToDateCost: z.number().nullable(),
    }),
  ),
  /** Failing / warning configuration (CF-xxx) results, one row per affected organization. */
  deviations: z.array(
    z.object({
      ruleId: z.string(),
      ruleName: z.string(),
      severity: z.string(),
      status: z.string(),
      organizationId: z.string().nullable(),
      message: z.string(),
    }),
  ),
});

export type DetailManifest = z.infer<typeof detailManifestSchema>;
export type DetailManifestFile = z.infer<typeof manifestFile>;
export type DetailMembers = z.infer<typeof detailMembersSchema>;
export type DetailApiKeys = z.infer<typeof detailApiKeysSchema>;
export type DetailActivity = z.infer<typeof detailActivitySchema>;
export type DetailOrgGroups = z.infer<typeof detailOrgGroupsSchema>;
