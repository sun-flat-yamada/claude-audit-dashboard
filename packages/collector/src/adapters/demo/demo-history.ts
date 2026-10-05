import type {
  Activity,
  AdoptionDay,
  CostRow,
  Credential,
  DatasetCollector,
  DatasetMap,
  DatasetName,
  Invite,
  Member,
  OrgSettings,
  SpendLimit,
  UsageRow,
} from '@claude-audit/core';
import { DataUnavailableError, addDays, round } from '@claude-audit/core';
import { DEMO_NOW } from './demo-source.js';

/**
 * Multi-time-point synthetic history of the demo tenant (F-015). The tenant of `demo-source.ts`
 * is the LATEST point (T3, `DEMO_NOW`) and is never altered; every earlier point is the same
 * tenant with a scenario applied: rules disabled or tuned, datasets not collected, and changed
 * members, activity, settings, keys and cost. Everything is deterministic (fixed clocks).
 *
 * Intended changes (rule: T1 / T2 / T3):
 * - pass -> fail: AK-003 (T1 -> T2), CF-003 and UA-001 (T2 -> T3)
 * - fail -> pass: CF-006 (T1 -> T2), AC-002 and OP-002 (T2 -> T3)
 * - warning -> pass: AM-002 (T1 -> T2); pass -> warning: AM-006 (T1 -> T2)
 * - pass -> skipped: AC-004, UA-003, UA-004 (T1 -> T2); skipped -> fail / warning (T2 -> T3)
 * - error -> pass: UA-001 (invalid parameter at T1 -> T2)
 * - rule added / removed: DG-001 and AM-007 added, AK-002 removed (T1 -> T2); AK-002 added again
 * - coverage: invites ok -> error -> ok, spendLimits ok -> unavailable -> ok,
 *   groups unavailable -> error -> ok
 * - UA-002: pass -> warning (T1 -> T2, the forecast exceeds the budget), warning -> pass (T2 -> T3)
 * - members 34 -> 43 -> 40, monthly active users 23 -> 35 -> 30, month-to-date cost 132 -> about
 *   4,960 -> 4,776 (a mid-month spike that is cleared by T3)
 */

type Transforms = {
  [K in DatasetName]?: (items: DatasetMap[K], now: Date) => DatasetMap[K];
};

export interface DemoScenario {
  /** Rule ids left out of the judgement of this point. */
  disabledRules: readonly string[];
  /** Rule parameter overrides of this point, keyed by rule id (may be invalid on purpose). */
  params: Readonly<Record<string, unknown>>;
  /** Datasets reported `unavailable` (the dataset is not collected here). */
  unavailable: Readonly<Partial<Record<DatasetName, string>>>;
  /** Datasets whose collection fails with an error. */
  failing: Readonly<Partial<Record<DatasetName, string>>>;
  transforms: Transforms;
}

export interface DemoTimePoint {
  /** Position, 1 = oldest; the last point is the latest and has the empty scenario. */
  index: number;
  now: Date;
  scenario: DemoScenario;
}

const ago = (now: Date, days: number): string => addDays(now, -days).toISOString();

const scale = (value: number, factor: number): number => Math.round(value * factor);

const scaleCost = (rows: CostRow[], factor: number): CostRow[] =>
  rows.map((r) => ({
    ...r,
    amount: round(r.amount * factor),
    listAmount: r.listAmount === null ? null : round(r.listAmount * factor),
  }));

const scaleUsage = (rows: UsageRow[], factor: number): UsageRow[] =>
  rows.map((r) => ({
    ...r,
    uncachedInputTokens: scale(r.uncachedInputTokens, factor),
    cacheReadInputTokens: scale(r.cacheReadInputTokens, factor),
    cacheCreationInputTokens: scale(r.cacheCreationInputTokens, factor),
    outputTokens: scale(r.outputTokens, factor),
    requests: r.requests === null ? null : scale(r.requests, factor),
  }));

const shiftActiveUsers = (rows: AdoptionDay[], delta: number): AdoptionDay[] =>
  rows.map((r) => {
    const monthly = r.monthlyActiveUsers + delta;
    return {
      ...r,
      monthlyActiveUsers: monthly,
      weeklyActiveUsers: r.weeklyActiveUsers + Math.round(delta * 0.7),
      dailyActiveUsers: r.dailyActiveUsers + Math.round(delta * 0.5),
      monthlyAdoptionRate:
        r.assignedSeats === null ? null : round((monthly / r.assignedSeats) * 100, 1),
    };
  });

/** Three members who joined recently (synthetic, example.com). */
const extraMembers = (now: Date): Member[] =>
  ['Kim', 'Lee', 'Max'].map((first, i) => ({
    id: `user_demo_${String(41 + i)}`,
    email: `${first}.Trainee@example.com`.toLowerCase(),
    name: `${first} Trainee`,
    role: 'user',
    organizationId: null,
    joinedAt: ago(now, 2 + i),
  }));

const withSettings = (
  settings: OrgSettings[],
  overrides: Readonly<Record<string, boolean>>,
): OrgSettings[] =>
  settings.map((org) => ({
    ...org,
    values: {
      ...org.values,
      ...Object.fromEntries(
        Object.entries(overrides).map(([name, value]) => [name, { type: 'boolean', value }]),
      ),
    },
  }));

/** Remove the failed-login burst (AM-006) and add one identity-provider change (AM-002). */
const calmerActivities = (items: Activity[], now: Date): Activity[] => [
  ...items.filter((a) => a.type !== 'sso_login_failed'),
  {
    id: 'activity_demo_0900',
    type: 'org_sso_toggled',
    createdAt: addDays(now, -0.2).toISOString(),
    organizationId: null,
    actor: { kind: 'user_actor', id: 'user_demo_002', email: 'bob.engineer@example.com', ip: null },
    attributes: {},
  },
];

/** The SIEM key was created only 150 days ago (still within the rotation threshold). */
const youngerKeys = (items: Credential[], now: Date): Credential[] =>
  items.map((c) => (c.id === 'apikey_demo_siem' ? { ...c, createdAt: ago(now, 150) } : c));

const withoutStaleInvite = (items: Invite[]): Invite[] =>
  items.filter((i) => i.id !== 'invite_demo_3');

/** Every member has a limit and nobody is close to it. */
const comfortableLimits = (items: SpendLimit[]): SpendLimit[] =>
  items.map((r) => ({
    ...r,
    limit: r.limit ?? 150,
    spent: round(r.spent * 0.5),
  }));

const EMPTY: DemoScenario = {
  disabledRules: [],
  params: {},
  unavailable: {},
  failing: {},
  transforms: {},
};

const T1: DemoScenario = {
  disabledRules: ['DG-001', 'AM-007'],
  params: { 'AC-002': { maxAdminPercentage: 10 }, 'UA-001': { spikeMultiplier: -1 } },
  unavailable: { groups: 'Directory groups are not enabled yet' },
  failing: {},
  transforms: {
    members: (items) => items.slice(0, 34),
    adoption: (items) => shiftActiveUsers(items, -7),
    cost: (items) => scaleCost(items, 0.8),
    usage: (items) => scaleUsage(items, 0.85),
    settings: (items) =>
      withSettings(items, { public_projects_enabled: true, ip_allowlist_enabled: true }),
    activities: calmerActivities,
    credentials: youngerKeys,
    invites: withoutStaleInvite,
    spendLimits: comfortableLimits,
  },
};

const T2: DemoScenario = {
  disabledRules: ['AK-002'],
  params: { 'AC-002': { maxAdminPercentage: 10 }, 'UA-001': { spikeMultiplier: 50 } },
  unavailable: { spendLimits: 'Usage credits are disabled for this period' },
  failing: {
    invites: 'Upstream 503 while listing invites',
    groups: 'Upstream 500 while listing groups',
  },
  transforms: {
    members: (items, now) => [...items, ...extraMembers(now)],
    adoption: (items) => shiftActiveUsers(items, 2),
    cost: (items) => scaleCost(items, 1.8),
    usage: (items) => scaleUsage(items, 1.2),
    settings: (items) => withSettings(items, { ip_allowlist_enabled: true }),
  },
};

/** Days before the latest point of T1 and T2. */
const OFFSETS = [28, 14] as const;

/** The time points, oldest first; the last one is the latest and equals the public sample. */
export const DEMO_TIME_POINTS: readonly DemoTimePoint[] = [
  { index: 1, now: addDays(DEMO_NOW, -OFFSETS[0]), scenario: T1 },
  { index: 2, now: addDays(DEMO_NOW, -OFFSETS[1]), scenario: T2 },
  { index: 3, now: DEMO_NOW, scenario: EMPTY },
];

function applyTransform<K extends DatasetName>(
  collector: DatasetCollector<K>,
  scenario: DemoScenario,
): DatasetCollector<K> {
  const { dataset } = collector;
  const unavailable = scenario.unavailable[dataset];
  const failing = scenario.failing[dataset];
  const transform = scenario.transforms[dataset] as
    ((items: DatasetMap[K], now: Date) => DatasetMap[K]) | undefined;
  if (unavailable === undefined && failing === undefined && !transform) return collector;
  return {
    ...collector,
    async collect(context) {
      if (unavailable !== undefined) throw new DataUnavailableError(unavailable);
      if (failing !== undefined) throw new Error(failing);
      const result = await collector.collect(context);
      return transform ? { ...result, items: transform(result.items, context.now) } : result;
    },
  };
}

/** The collectors of one time point: the demo collectors with the scenario applied. */
export function scenarioCollectors(
  collectors: readonly DatasetCollector[],
  scenario: DemoScenario,
): DatasetCollector[] {
  return collectors.map((c) => applyTransform(c, scenario));
}
