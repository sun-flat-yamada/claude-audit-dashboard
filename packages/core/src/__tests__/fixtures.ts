import {
  DATASET_NAMES,
  emptyData,
  type Coverage,
  type DatasetMap,
  type DatasetMeta,
} from '../domain/model/dataset.js';
import type { Activity, CostRow, Credential, Member, UsageRow } from '../domain/model/entities.js';
import type { AuditSnapshot } from '../domain/model/snapshot.js';

export const NOW = new Date('2026-09-30T12:00:00.000Z');

export const daysAgo = (days: number, from: Date = NOW): string =>
  new Date(from.getTime() - days * 86_400_000).toISOString();

export const dayString = (days: number): string => daysAgo(days).slice(0, 10);

export const member = (id: string, overrides: Partial<Member> = {}): Member => ({
  id,
  email: `${id}@example.com`,
  name: id,
  role: 'user',
  organizationId: null,
  joinedAt: daysAgo(400),
  ...overrides,
});

export const credential = (id: string, overrides: Partial<Credential> = {}): Credential => ({
  id,
  name: id,
  scopes: ['read:compliance_activities'],
  active: true,
  createdAt: daysAgo(100),
  expiresAt: null,
  createdBy: null,
  ...overrides,
});

export const activity = (id: string, overrides: Partial<Activity> = {}): Activity => ({
  id,
  type: 'claude_chat_created',
  createdAt: daysAgo(0.1),
  organizationId: 'org-1',
  actor: { kind: 'user_actor', id: 'user-1', email: 'user-1@example.com', ip: '192.0.2.1' },
  attributes: {},
  ...overrides,
});

export const usageRow = (
  date: string,
  tokens: number,
  overrides: Partial<UsageRow> = {},
): UsageRow => ({
  date,
  dimension: 'total',
  key: null,
  uncachedInputTokens: tokens,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  webSearchRequests: 0,
  requests: null,
  ...overrides,
});

export const costRow = (
  date: string,
  amount: number,
  overrides: Partial<CostRow> = {},
): CostRow => ({
  date,
  dimension: 'total',
  key: null,
  amount,
  listAmount: null,
  currency: 'USD',
  ...overrides,
});

const okCoverage = (data: DatasetMap): Coverage =>
  Object.fromEntries(
    DATASET_NAMES.map((name): [string, DatasetMeta] => [
      name,
      {
        status: 'ok',
        count: data[name].length,
        window: { from: daysAgo(120), to: NOW.toISOString() },
      },
    ]),
  );

/** Snapshot with every dataset collected (`ok`); override data or coverage per test. */
export function snapshot(
  data: Partial<DatasetMap> = {},
  coverage: Coverage = {},
  collectedAt: string = NOW.toISOString(),
): AuditSnapshot {
  const full = { ...emptyData(), ...data };
  return {
    schemaVersion: 2,
    id: 'snap-1',
    collectedAt,
    coverage: { ...okCoverage(full), ...coverage },
    data: full,
  };
}
