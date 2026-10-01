import type {
  Activity,
  AdoptionDay,
  CostRow,
  Credential,
  CredentialUsage,
  Group,
  Invite,
  Member,
  MemberActivity,
  OrgSettings,
  Organization,
  SpendLimit,
  UsageRow,
} from './entities.js';

/**
 * Every dataset a snapshot can carry. Adding a data source starts with one line here;
 * rules and analyzers then declare the datasets they need in `requires`.
 */
export interface DatasetMap {
  organizations: Organization[];
  members: Member[];
  memberActivity: MemberActivity[];
  invites: Invite[];
  groups: Group[];
  settings: OrgSettings[];
  credentials: Credential[];
  credentialUsage: CredentialUsage[];
  activities: Activity[];
  usage: UsageRow[];
  cost: CostRow[];
  adoption: AdoptionDay[];
  spendLimits: SpendLimit[];
}

export type DatasetName = keyof DatasetMap;

export type DatasetData = Partial<DatasetMap>;

/** All datasets empty; the return type guarantees the list stays complete. */
export const emptyData = (): DatasetMap => ({
  organizations: [],
  members: [],
  memberActivity: [],
  invites: [],
  groups: [],
  settings: [],
  credentials: [],
  credentialUsage: [],
  activities: [],
  usage: [],
  cost: [],
  adoption: [],
  spendLimits: [],
});

export const DATASET_NAMES = Object.keys(emptyData()) as DatasetName[];

export const isDatasetName = (value: string): value is DatasetName =>
  (DATASET_NAMES as string[]).includes(value);

/**
 * - `ok`: collected (possibly zero items — zero is then a fact, not a gap)
 * - `unavailable`: not collectable here (missing key or scope, feature disabled)
 * - `error`: collection failed (transient error or schema drift)
 */
export type DatasetStatus = 'ok' | 'unavailable' | 'error';

export interface TimeWindow {
  from: string;
  to: string;
}

export interface DatasetMeta {
  status: DatasetStatus;
  source?: string | undefined;
  reason?: string | undefined;
  count?: number | undefined;
  /** Period the items cover, for time-bounded datasets. */
  window?: TimeWindow | undefined;
  /** Freshness watermark reported by the API (e.g. analytics `data_refreshed_at`). */
  asOf?: string | undefined;
}

export type Coverage = Partial<Record<DatasetName, DatasetMeta>>;

/** Fills datasets that were not collected with empty arrays. */
export const withDefaults = (data: DatasetData): DatasetMap => ({ ...emptyData(), ...data });

/** Explains why the given datasets cannot be relied on, or returns null when all are `ok`. */
export function missingRequirements(
  requires: readonly DatasetName[],
  coverage: Coverage,
): string | null {
  const problems = requires.flatMap((name) => {
    const meta = coverage[name];
    if (!meta) return [`${name} was not collected`];
    if (meta.status === 'ok') return [];
    return [`${name} ${meta.status}${meta.reason ? ` (${meta.reason})` : ''}`];
  });
  return problems.length === 0 ? null : `Required data missing: ${problems.join('; ')}`;
}
