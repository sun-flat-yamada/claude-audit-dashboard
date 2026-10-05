import type { DetailConfig } from '../../contracts/config-view.js';
import { CONFIG_VIEW_SCHEMA_VERSION, DETAIL_CONFIG_PATH } from '../../contracts/config-view.js';
import type {
  DetailActivity,
  DetailApiKeys,
  DetailManifest,
  DetailManifestFile,
  DetailMembers,
  DetailOrgGroups,
} from '../../contracts/detail-view.js';
import {
  DETAIL_API_KEYS_PATH,
  DETAIL_DIR,
  DETAIL_MEMBERS_PATH,
  DETAIL_ORG_GROUPS_PATH,
  DETAIL_SCHEMA_VERSION,
  detailActivityPath,
} from '../../contracts/detail-view.js';
import type { ComplianceReport } from '../../domain/compliance/types.js';
import { withDefaults, type DatasetMap, type DatasetName } from '../../domain/model/dataset.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import { identityMasker, type IdentityMasker } from '../../domain/util/mask.js';
import { buildConfigView, type ConfigViewInput } from './config-view.js';
import { buildDetailActivity } from './detail-activity.js';
import { buildDetailApiKeys } from './detail-api-keys.js';
import { buildDetailMembers } from './detail-members.js';
import { buildDetailOrgGroups } from './detail-org-groups.js';

/** Effective thresholds of the rules whose verdicts the detail screens explain. */
export interface DetailThresholds {
  inactiveDays: number;
  unusedDays: number;
  maxAgeDays: number;
}

/** Defaults of AC-001, AK-001 and AK-003. */
export const DEFAULT_DETAIL_THRESHOLDS: DetailThresholds = {
  inactiveDays: 90,
  unusedDays: 30,
  maxAgeDays: 180,
};

export interface DetailInput {
  now: Date;
  source: 'live' | 'demo';
  maskPii: boolean;
  snapshot: AuditSnapshot | null;
  report: ComplianceReport | null;
  thresholds: DetailThresholds;
  /** Effective configuration (allowlist input); omitted when the caller has none to publish. */
  config?: Omit<ConfigViewInput, 'now'> | undefined;
}

export interface DetailFile {
  path: string;
  /** Plain object, parsed by its schema at the single write site. */
  content: DetailMembers | DetailApiKeys | DetailActivity | DetailOrgGroups | DetailConfig;
}

export interface DetailBundle {
  manifest: DetailManifest;
  files: DetailFile[];
}

const collected = (snapshot: AuditSnapshot | null, name: DatasetName): boolean =>
  snapshot?.coverage[name]?.status === 'ok';

function unavailable(
  snapshot: AuditSnapshot | null,
  kind: DetailManifestFile['kind'],
  path: string,
  dataset: DatasetName,
): DetailManifestFile {
  const meta = snapshot?.coverage[dataset];
  return {
    kind,
    path,
    schemaVersion: DETAIL_SCHEMA_VERSION,
    status: 'unavailable',
    reason: meta ? `${dataset} ${meta.status}` : `${dataset} was not collected`,
    count: null,
    month: null,
  };
}

const available = (
  kind: DetailManifestFile['kind'],
  path: string,
  count: number,
  month: string | null = null,
  schemaVersion: number = DETAIL_SCHEMA_VERSION,
): DetailManifestFile => ({
  kind,
  path,
  schemaVersion,
  status: 'ok',
  reason: null,
  count,
  month,
});

interface Part {
  files: DetailFile[];
  entries: DetailManifestFile[];
}

interface Ctx extends DetailInput {
  mask: IdentityMasker;
  data: DatasetMap;
}

/** Glob marker: an unavailable activity dataset has no month files. */
const ACTIVITY_GLOB = `${DETAIL_DIR}/activity-*.json`;

function membersPart(c: Ctx): Part {
  if (!collected(c.snapshot, 'members'))
    return {
      files: [],
      entries: [unavailable(c.snapshot, 'members', DETAIL_MEMBERS_PATH, 'members')],
    };
  const content = buildDetailMembers({
    now: c.now,
    data: c.data,
    activityCollected: collected(c.snapshot, 'memberActivity'),
    inactiveDays: c.thresholds.inactiveDays,
    mask: c.mask,
  });
  return {
    files: [{ path: DETAIL_MEMBERS_PATH, content }],
    entries: [available('members', DETAIL_MEMBERS_PATH, content.members.length)],
  };
}

function apiKeysPart(c: Ctx): Part {
  if (!collected(c.snapshot, 'credentials'))
    return {
      files: [],
      entries: [unavailable(c.snapshot, 'api-keys', DETAIL_API_KEYS_PATH, 'credentials')],
    };
  const content = buildDetailApiKeys({
    now: c.now,
    data: c.data,
    usageWindow: c.snapshot?.coverage.credentialUsage?.window ?? null,
    unusedDays: c.thresholds.unusedDays,
    maxAgeDays: c.thresholds.maxAgeDays,
    mask: c.mask,
  });
  return {
    files: [{ path: DETAIL_API_KEYS_PATH, content }],
    entries: [available('api-keys', DETAIL_API_KEYS_PATH, content.keys.length)],
  };
}

function activityPart(c: Ctx): Part {
  if (!collected(c.snapshot, 'activities'))
    return {
      files: [],
      entries: [unavailable(c.snapshot, 'activity', ACTIVITY_GLOB, 'activities')],
    };
  const months = buildDetailActivity(c.now, c.data.activities, c.mask);
  return {
    files: months.map((content) => ({ path: detailActivityPath(content.month), content })),
    entries: months.map((m) =>
      available('activity', detailActivityPath(m.month), m.items.length, m.month),
    ),
  };
}

function orgGroupsPart(c: Ctx): Part {
  if (!collected(c.snapshot, 'organizations') && !collected(c.snapshot, 'groups'))
    return {
      files: [],
      entries: [unavailable(c.snapshot, 'org-groups', DETAIL_ORG_GROUPS_PATH, 'organizations')],
    };
  const content = buildDetailOrgGroups({
    now: c.now,
    data: c.data,
    costCollected: collected(c.snapshot, 'cost'),
    results: c.report?.results ?? [],
    mask: c.mask,
  });
  return {
    files: [{ path: DETAIL_ORG_GROUPS_PATH, content }],
    entries: [available('org-groups', DETAIL_ORG_GROUPS_PATH, content.groups.length)],
  };
}

function configPart(c: Ctx): Part {
  if (!c.config) return { files: [], entries: [] };
  const content = buildConfigView({ ...c.config, now: c.now });
  return {
    files: [{ path: DETAIL_CONFIG_PATH, content }],
    entries: [
      available(
        'config',
        DETAIL_CONFIG_PATH,
        content.rules.length,
        null,
        CONFIG_VIEW_SCHEMA_VERSION,
      ),
    ],
  };
}

/** Builds the manifest and the entity files; pure and deterministic for the same input. */
export function buildDetailView(input: DetailInput): DetailBundle {
  const ctx: Ctx = {
    ...input,
    mask: identityMasker(input.maskPii),
    data: withDefaults(input.snapshot?.data ?? {}),
  };
  const parts = [
    membersPart(ctx),
    apiKeysPart(ctx),
    activityPart(ctx),
    orgGroupsPart(ctx),
    configPart(ctx),
  ];
  return {
    manifest: {
      schemaVersion: DETAIL_SCHEMA_VERSION,
      generatedAt: input.now.toISOString(),
      collectedAt: input.snapshot?.collectedAt ?? null,
      source: input.source,
      maskPii: input.maskPii,
      files: parts.flatMap((p) => p.entries),
    },
    files: parts.flatMap((p) => p.files),
  };
}
