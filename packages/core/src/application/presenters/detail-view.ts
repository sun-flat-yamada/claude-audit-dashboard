import type { DetailAlerts } from '../../contracts/alerts-view.js';
import { ALERTS_VIEW_SCHEMA_VERSION, DETAIL_ALERTS_PATH } from '../../contracts/alerts-view.js';
import type { DetailArchive } from '../../contracts/archive-view.js';
import { ARCHIVE_VIEW_SCHEMA_VERSION, DETAIL_ARCHIVE_PATH } from '../../contracts/archive-view.js';
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
import type { CompareIndex, TimePointSummary } from '../../contracts/time-point-summary.js';
import {
  COMPARE_INDEX_PATH,
  COMPARE_SCHEMA_VERSION,
  comparePointPath,
} from '../../contracts/time-point-summary.js';
import type { ComplianceReport } from '../../domain/compliance/types.js';
import { withDefaults, type DatasetMap, type DatasetName } from '../../domain/model/dataset.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import { identityMasker, type IdentityMasker } from '../../domain/util/mask.js';
import { buildAlertsView, type AlertsViewInput } from './alerts-view.js';
import { buildArchiveView, type ArchiveEntry } from './archive-view.js';
import { buildConfigView, type ConfigViewInput } from './config-view.js';
import { buildDetailActivity } from './detail-activity.js';
import { buildDetailApiKeys } from './detail-api-keys.js';
import { buildDetailMembers } from './detail-members.js';
import { buildDetailOrgGroups } from './detail-org-groups.js';
import { buildCompareIndex } from './time-point-summary.js';

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
  /**
   * The archive listing (I/O stays with the caller); `entries: null` means it could not be
   * listed. Omitted when the caller has no archive to report on.
   */
  archive?: { snapshotDays: number; entries: readonly ArchiveEntry[] | null } | undefined;
  /**
   * The send records and acknowledgements (I/O stays with the caller); `null` means they could
   * not be read. Omitted when the caller has no alert history to report on.
   */
  alerts?: Omit<AlertsViewInput, 'now'> | null | undefined;
  /**
   * The stored time-point summaries (F-015; I/O stays with the caller). Omitted when the caller
   * has none to publish; `null` means they could not be read.
   */
  summaries?: readonly TimePointSummary[] | null | undefined;
}

export interface DetailFile {
  path: string;
  /** Plain object, parsed by its schema at the single write site. */
  content:
    | DetailMembers
    | DetailApiKeys
    | DetailActivity
    | DetailOrgGroups
    | DetailConfig
    | DetailArchive
    | DetailAlerts
    | CompareIndex
    | TimePointSummary;
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

function archivePart(c: Ctx): Part {
  if (!c.archive) return { files: [], entries: [] };
  if (c.archive.entries === null)
    return {
      files: [],
      entries: [
        {
          kind: 'archive',
          path: DETAIL_ARCHIVE_PATH,
          schemaVersion: ARCHIVE_VIEW_SCHEMA_VERSION,
          status: 'unavailable',
          reason: 'the archive could not be listed',
          count: null,
          month: null,
        },
      ],
    };
  const content = buildArchiveView({
    now: c.now,
    snapshotDays: c.archive.snapshotDays,
    entries: c.archive.entries,
  });
  return {
    files: [{ path: DETAIL_ARCHIVE_PATH, content }],
    entries: [
      available(
        'archive',
        DETAIL_ARCHIVE_PATH,
        content.totals.snapshots,
        null,
        ARCHIVE_VIEW_SCHEMA_VERSION,
      ),
    ],
  };
}

function alertsPart(c: Ctx): Part {
  if (c.alerts === undefined) return { files: [], entries: [] };
  if (c.alerts === null)
    return {
      files: [],
      entries: [
        {
          kind: 'alerts',
          path: DETAIL_ALERTS_PATH,
          schemaVersion: ALERTS_VIEW_SCHEMA_VERSION,
          status: 'unavailable',
          reason: 'the alert history could not be read',
          count: null,
          month: null,
        },
      ],
    };
  const content = buildAlertsView({ ...c.alerts, now: c.now });
  return {
    files: [{ path: DETAIL_ALERTS_PATH, content }],
    entries: [
      available(
        'alerts',
        DETAIL_ALERTS_PATH,
        content.alerts.length,
        null,
        ALERTS_VIEW_SCHEMA_VERSION,
      ),
    ],
  };
}

function comparePart(c: Ctx): Part {
  if (c.summaries === undefined) return { files: [], entries: [] };
  const unavailable = (reason: string): Part => ({
    files: [],
    entries: [
      {
        kind: 'compare',
        path: COMPARE_INDEX_PATH,
        schemaVersion: COMPARE_SCHEMA_VERSION,
        status: 'unavailable',
        reason,
        count: null,
        month: null,
      },
    ],
  });
  if (c.summaries === null) return unavailable('the time-point summaries could not be read');
  if (c.summaries.length === 0) return unavailable('no time point has been judged yet');
  const index = buildCompareIndex(c.summaries, c.now);
  const listed = new Set(index.points.map((p) => p.id));
  return {
    files: [
      { path: COMPARE_INDEX_PATH, content: index },
      ...c.summaries
        .filter((s) => listed.has(s.id))
        .map((s) => ({ path: comparePointPath(s.id), content: s })),
    ],
    entries: [
      available('compare', COMPARE_INDEX_PATH, index.points.length, null, COMPARE_SCHEMA_VERSION),
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
    archivePart(ctx),
    alertsPart(ctx),
    comparePart(ctx),
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
