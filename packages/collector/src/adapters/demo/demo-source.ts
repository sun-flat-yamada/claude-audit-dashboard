import type {
  AckStore,
  Activity,
  AdoptionDay,
  CollectorState,
  CostRow,
  Credential,
  DatasetCollector,
  DatasetMap,
  DatasetName,
  DateRange,
  Group,
  MatrixCostRow,
  Member,
  MemberActivity,
  OrgSettings,
  SentRecord,
  SpendLimit,
  UsageDimension,
  UsageMatrixInput,
  UsageRow,
} from '@claude-audit/core';
import {
  addDays,
  aggregateMatrixRows,
  alertId,
  earlierOf,
  initialState,
  round,
  startOfUtcDay,
  toIsoDate,
} from '@claude-audit/core';
import { activityHistory } from './demo-activity-history.js';

/**
 * Deterministic synthetic tenant for `pnpm demo`, sample data and tests.
 * Names are fictional and every address uses example.com / documentation IP ranges.
 */
export const DEMO_NOW = new Date('2026-09-29T12:00:00.000Z');

/** mulberry32 seeded from a string: same seed, same sequence. */
function random(seed: string): () => number {
  let a = [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761), 1779033703) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ago = (now: Date, days: number): string => addDays(now, -days).toISOString();

const ORGS = [
  { id: '5f0c7a1e-1111-4a1a-9a11-000000000001', name: 'Example Corp Engineering' },
  { id: '5f0c7a1e-2222-4a1a-9a11-000000000002', name: 'Example Corp Legal' },
  { id: '5f0c7a1e-3333-4a1a-9a11-000000000003', name: 'Example Corp Sales' },
];

const FIRST = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy'];
const LAST = ['Engineer', 'Analyst', 'Counsel', 'Designer'];
const INACTIVE = new Set([20, 27, 33, 35]);

const roleFor = (i: number): string =>
  i === 0
    ? 'primary_owner'
    : i <= 2
      ? 'owner'
      : i <= 4
        ? 'membership_admin'
        : i <= 9
          ? 'managed'
          : 'user';

function members(now: Date): Member[] {
  return Array.from({ length: 40 }, (_, i) => {
    const first = FIRST[i % FIRST.length] ?? 'User';
    const last = LAST[Math.floor(i / FIRST.length)] ?? 'Member';
    const joinedDaysAgo = i >= 37 ? 5 + (i - 37) * 7 : 30 + ((i * 17) % 600);
    return {
      id: `user_demo_${String(i + 1).padStart(3, '0')}`,
      email: `${first}.${last}@example.com`.toLowerCase(),
      name: `${first} ${last}`,
      role: roleFor(i),
      organizationId: null,
      joinedAt: ago(now, joinedDaysAgo),
    };
  });
}

const memberActivity = (now: Date): MemberActivity[] =>
  members(now).flatMap((m, i) =>
    INACTIVE.has(i)
      ? []
      : [
          {
            userId: m.id,
            email: m.email,
            active: true,
            lastActiveOn: toIsoDate(addDays(now, -(1 + (i % 15)))),
          },
        ],
  );

const retention = (duration: number | null, timescale = 'day') =>
  duration === null
    ? { chat: { type: 'indefinite' } }
    : { chat: { type: 'fixed', duration, timescale } };

function settings(): OrgSettings[] {
  const perOrg = [
    { ip: true, retention: retention(180) },
    { ip: true, retention: { all: { type: 'fixed', duration: 84, timescale: 'month' } } },
    { ip: false, retention: retention(null) },
  ];
  return ORGS.map((org, i) => {
    const custom = perOrg[i] ?? perOrg[0]!;
    const values: Record<string, unknown> = {
      sso_claude_ai_enforced: true,
      sso_provisioning_mode: 'scim_advanced',
      ip_allowlist_enabled: custom.ip,
      account_session_duration_seconds: 86_400,
      data_retention_periods: custom.retention,
      public_projects_enabled: false,
      code_execution_network_egress_enabled: false,
      claude_code_desktop_bypass_permissions_enabled: false,
      allowed_invite_domains: ['example.com'],
    };
    return {
      organizationId: org.id,
      organizationName: org.name,
      values: Object.fromEntries(
        Object.entries(values).map(([name, value]) => [name, { type: typeof value, value }]),
      ),
    };
  });
}

const credentials = (now: Date): Credential[] => [
  {
    id: 'apikey_demo_dashboard',
    name: 'Audit dashboard',
    scopes: [
      'read:compliance_activities',
      'read:compliance_org_data',
      'read:members',
      'read:rbac_groups',
      'read:analytics',
      'read:spend_limits',
    ],
    active: true,
    createdAt: ago(now, 60),
    expiresAt: null,
    createdBy: 'user_demo_001',
  },
  {
    id: 'apikey_demo_siem',
    name: 'SIEM export',
    scopes: ['read:compliance_activities'],
    active: true,
    createdAt: ago(now, 400),
    expiresAt: null,
    createdBy: 'user_demo_002',
  },
  {
    id: 'apikey_demo_ediscovery',
    name: 'eDiscovery (legal hold)',
    scopes: ['read:compliance_user_data', 'delete:compliance_user_data'],
    active: true,
    createdAt: ago(now, 120),
    expiresAt: null,
    createdBy: 'user_demo_002',
  },
  {
    id: 'apikey_demo_retired',
    name: 'Retired pilot key',
    scopes: ['read:compliance_activities'],
    active: false,
    createdAt: ago(now, 500),
    expiresAt: null,
    createdBy: null,
  },
];

const GROUPS: Group[] = [
  {
    id: 'rbac_group_demo_engineering',
    name: 'Engineering',
    source: 'scim',
    roleIds: ['rbac_role_demo_builder'],
    memberCount: 18,
  },
  {
    id: 'rbac_group_demo_legal',
    name: 'Legal',
    source: 'direct',
    roleIds: ['rbac_role_demo_reviewer'],
    memberCount: 6,
  },
  { id: 'rbac_group_demo_sales', name: 'Sales', source: 'scim', roleIds: [], memberCount: 9 },
  {
    id: 'rbac_group_demo_pilot',
    name: 'Pilot Program',
    source: 'direct',
    roleIds: ['rbac_role_demo_builder'],
    memberCount: 0,
  },
];

function spendLimits(now: Date): SpendLimit[] {
  return members(now).map((m, i) => ({
    userId: m.id,
    email: m.email,
    period: 'monthly',
    limit: i <= 2 ? null : 150,
    spent: i === 7 ? 141 : i === 8 ? 146 : round(20 + ((i * 37) % 110)),
    source: i <= 2 ? 'organization' : 'seat_tier',
    currency: 'USD',
  }));
}

const actor = (m: Member, ip: string) => ({ kind: 'user_actor', id: m.id, email: m.email, ip });

function recentActivities(now: Date): Activity[] {
  const people = members(now);
  const rand = random('activities');
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const event = (
    n: number,
    type: string,
    hoursAgo: number,
    who: Activity['actor'],
    attributes: Record<string, unknown> = {},
  ): Activity => ({
    id: `activity_demo_${String(n).padStart(4, '0')}`,
    type,
    createdAt: at(hoursAgo),
    organizationId: ORGS[n % ORGS.length]?.id ?? null,
    actor: who,
    attributes,
  });
  const routine = [
    'claude_chat_created',
    'claude_file_uploaded',
    'claude_project_created',
    'sso_login_succeeded',
  ];
  const person = (i: number) => people[i % people.length] as Member;
  const api = (id: string) => ({ kind: 'api_actor', id, email: null, ip: '203.0.113.10' });
  const stranger = {
    kind: 'unauthenticated_user_actor',
    id: null,
    email: 'unknown.user@example.com',
    ip: '198.51.100.23',
  };
  return [
    ...Array.from({ length: 40 }, (_, i) =>
      event(
        i + 1,
        routine[i % routine.length] ?? 'claude_chat_created',
        1 + rand() * 22,
        actor(person(i * 7 + 3), '192.0.2.10'),
      ),
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      event(100 + i, 'compliance_api_accessed', 0.5 + i * 3, api('apikey_demo_dashboard')),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      event(120 + i, 'compliance_api_accessed', 2 + i * 5, api('apikey_demo_siem')),
    ),
    event(200, 'claude_user_role_updated', 5, actor(person(0), '192.0.2.10'), {
      user_id: 'user_demo_012',
      user_email: 'bob.analyst@example.com',
      previous_role: 'user',
      current_role: 'owner',
    }),
    event(201, 'org_ip_restriction_updated', 7, actor(person(1), '192.0.2.11')),
    event(202, 'org_members_exported', 9, actor(person(3), '192.0.2.12')),
    ...Array.from({ length: 24 }, (_, i) =>
      event(300 + i, 'sso_login_failed', 3 + i * 0.1, stranger),
    ),
  ];
}

/** Two months of routine history plus the recent, rule-relevant events. */
const activities = (now: Date): Activity[] => [
  ...activityHistory(
    now,
    members(now),
    ORGS.map((o) => o.id),
    random('activity-history'),
  ),
  ...recentActivities(now),
];

// ─── Usage and cost ─────────────────────────────────────────────────────────

const SPLITS: Readonly<
  Record<
    Exclude<UsageDimension, 'total'>,
    { cost: Record<string, number>; tokens: Record<string, number> }
  >
> = {
  product: {
    cost: { chat: 0.45, claude_code: 0.4, cowork: 0.15 },
    tokens: { chat: 0.4, claude_code: 0.48, cowork: 0.12 },
  },
  model: {
    cost: { 'claude-opus-5': 0.62, 'claude-sonnet-5': 0.33, 'claude-haiku-4-5': 0.05 },
    tokens: { 'claude-opus-5': 0.3, 'claude-sonnet-5': 0.55, 'claude-haiku-4-5': 0.15 },
  },
  group: {
    cost: {
      rbac_group_demo_engineering: 0.7,
      rbac_group_demo_legal: 0.12,
      rbac_group_demo_sales: 0.22,
    },
    tokens: {
      rbac_group_demo_engineering: 0.72,
      rbac_group_demo_legal: 0.1,
      rbac_group_demo_sales: 0.22,
    },
  },
};

/** Relative activity of a day: weekends are quieter, the day before `now` spikes. */
function dayFactor(date: string, spikeDay: string): number {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const base = (weekday === 0 || weekday === 6 ? 0.45 : 1) * (0.9 + random(`day:${date}`)() * 0.2);
  return date === spikeDay ? base * 3.6 : base;
}

function days(range: DateRange, now: Date): string[] {
  const end = earlierOf(range.end, now);
  const out: string[] = [];
  for (let d = startOfUtcDay(range.start); d < end; d = addDays(d, 1)) out.push(toIsoDate(d));
  return out;
}

/** Share of a day's tokens read from the cache (0.12-0.32): same for every dimension of the day. */
const cacheReadShare = (date: string): number => 0.12 + random(`cache:${date}`)() * 0.2;

function usageRow(
  date: string,
  dimension: UsageDimension,
  key: string | null,
  tokens: number,
): UsageRow {
  // The uncached + cache read total keeps its earlier rounding, so token totals stay unchanged.
  const notWritten = Math.round(tokens * 0.55) + Math.round(tokens * 0.2);
  const read = Math.round(tokens * cacheReadShare(date));
  return {
    date,
    dimension,
    key,
    uncachedInputTokens: notWritten - read,
    cacheReadInputTokens: read,
    cacheCreationInputTokens: Math.round(tokens * 0.05),
    outputTokens: Math.round(tokens * 0.2),
    webSearchRequests: Math.round(tokens / 400_000),
    requests: Math.round(tokens / 12_000),
  };
}

const costRow = (
  date: string,
  dimension: UsageDimension,
  key: string | null,
  amount: number,
): CostRow => ({
  date,
  dimension,
  key,
  amount: round(amount),
  listAmount: round(amount * 1.15),
  currency: 'USD',
});

function breakdown<T>(
  range: DateRange,
  now: Date,
  total: number,
  measure: 'cost' | 'tokens',
  row: (date: string, dimension: UsageDimension, key: string | null, value: number) => T,
): T[] {
  const spikeDay = toIsoDate(addDays(now, -1));
  return days(range, now).flatMap((date) => {
    const value = total * dayFactor(date, spikeDay);
    const grouped = Object.entries(SPLITS).flatMap(([dimension, split]) =>
      Object.entries(split[measure]).map(([key, share]) =>
        row(date, dimension as UsageDimension, key, value * share),
      ),
    );
    return [row(date, 'total', null, value), ...grouped];
  });
}

const adoption = (range: DateRange, now: Date): AdoptionDay[] =>
  days(range, now).map((date) => {
    const r = random(`adoption:${date}`);
    const monthly = 30 + Math.round(r() * 3);
    return {
      date,
      dailyActiveUsers: 18 + Math.round(r() * 8),
      weeklyActiveUsers: 27 + Math.round(r() * 4),
      monthlyActiveUsers: monthly,
      assignedSeats: 45,
      monthlyAdoptionRate: round((monthly / 45) * 100, 1),
      pendingInvites: 3,
    };
  });

const invites = (now: Date): DatasetMap['invites'] => [
  {
    id: 'invite_demo_1',
    email: 'new.hire@example.com',
    role: 'user',
    status: 'pending',
    invitedAt: ago(now, 5),
    expiresAt: ago(now, -16),
  },
  {
    id: 'invite_demo_2',
    email: 'contractor@example.com',
    role: 'managed',
    status: 'pending',
    invitedAt: ago(now, 12),
    expiresAt: ago(now, -9),
  },
  {
    id: 'invite_demo_3',
    email: 'old.candidate@example.com',
    role: 'user',
    status: 'pending',
    invitedAt: ago(now, 47),
    expiresAt: ago(now, -2),
  },
];

// ─── Collectors ─────────────────────────────────────────────────────────────

const fixed = <K extends DatasetName>(
  dataset: K,
  items: (now: Date) => DatasetMap[K],
): DatasetCollector<K> => ({
  dataset,
  source: `demo:${dataset}`,
  collect: async ({ now }) => ({ items: items(now) }),
});

/** Demo equivalents of every Anthropic-backed collector. */
export function createDemoCollectors(): DatasetCollector[] {
  const refreshed = (now: Date) => `${toIsoDate(now)}T06:00:00.000Z`;
  return [
    fixed('organizations', () =>
      ORGS.map((o) => ({ ...o, createdAt: '2025-06-01T10:00:00.000Z' })),
    ),
    fixed('members', members),
    fixed('invites', invites),
    fixed('groups', () => GROUPS),
    fixed('settings', settings),
    fixed('credentials', credentials),
    fixed('spendLimits', spendLimits),
    {
      dataset: 'activities',
      source: 'demo:activities',
      collect: async ({ now }) => ({
        items: activities(now),
        window: { from: ago(now, 91), to: now.toISOString() },
      }),
    },
    {
      dataset: 'memberActivity',
      source: 'demo:memberActivity',
      collect: async ({ now }) => ({
        items: memberActivity(now),
        window: { from: ago(now, 91), to: now.toISOString() },
      }),
    },
    {
      dataset: 'adoption',
      source: 'demo:adoption',
      collect: async ({ now, range }) => ({ items: adoption(range, now) }),
    },
    {
      dataset: 'usage',
      source: 'demo:usage',
      collect: async ({ now, range }) => ({
        items: breakdown(range, now, 9_000_000, 'tokens', usageRow),
        asOf: refreshed(now),
      }),
    },
    {
      dataset: 'cost',
      source: 'demo:cost',
      collect: async ({ now, range }) => ({
        items: breakdown(range, now, 180, 'cost', costRow),
        asOf: refreshed(now),
      }),
    },
  ];
}

/**
 * Synthetic alert sends for the sample (F-008): several channels and severities, from a day to
 * three weeks old, in `state.json` `notifications.history` shape.
 */
export const demoAlertHistory = (now: Date): SentRecord[] => [
  {
    key: 'compliance:DG-001=fail,CF-003=fail',
    sentAt: ago(now, 20),
    severity: 'critical',
    channels: ['console', 'slack', 'email', 'discord'],
    title: 'Claude Enterprise audit: 2 finding(s), score 71%',
  },
  {
    key: 'compliance:UA-002=warning',
    sentAt: ago(now, 14),
    severity: 'medium',
    channels: ['console', 'discord'],
    title: 'Claude Enterprise audit: 1 finding(s), score 88%',
  },
  {
    key: 'document:monthly-2026-08',
    sentAt: ago(now, 9),
    severity: 'info',
    channels: ['console', 'email'],
    title: 'Monthly cost report 2026-08',
  },
  {
    key: 'collection:failure',
    sentAt: ago(now, 5),
    severity: 'high',
    channels: ['console', 'slack', 'discord'],
    title: 'Claude audit collection failure',
  },
  {
    key: 'compliance:AK-003=fail',
    sentAt: ago(now, 3),
    severity: 'high',
    channels: ['console', 'slack'],
    title: 'Claude Enterprise audit: 1 finding(s), score 84%',
  },
  {
    key: 'compliance:AC-001=fail,AK-001=warning',
    sentAt: ago(now, 1),
    severity: 'high',
    channels: ['console', 'slack', 'email'],
    title: 'Claude Enterprise audit: 2 finding(s), score 79%',
  },
];

/** Synthetic acknowledgements of three of the demo alerts (labels are fictional teams). */
export const demoAckStore = (now: Date): AckStore => {
  const sent = demoAlertHistory(now);
  const pick = (index: number, hoursLater: number, by: string) => {
    const record = sent[index] as SentRecord;
    return {
      alertId: alertId(record.key, record.sentAt),
      at: new Date(Date.parse(record.sentAt) + hoursLater * 3_600_000).toISOString(),
      by,
    };
  };
  return {
    schemaVersion: 1,
    acks: [pick(1, 5, 'finance-bot'), pick(3, 2, 'sec-oncall'), pick(4, 26, 'platform-ops')].sort(
      (a, b) => (a.alertId < b.alertId ? -1 : 1),
    ),
  };
};

/**
 * Starting state for the demo: key usage has been observed for 120 days and the alert history
 * holds the synthetic sends.
 */
export const demoState = (now: Date): CollectorState => ({
  ...initialState(),
  notifications: { lastSent: {}, history: demoAlertHistory(now) },
  projections: {
    credentialUsage: {
      observedSince: ago(now, 120),
      lastSeen: { apikey_demo_dashboard: ago(now, 0.25), apikey_demo_siem: ago(now, 2) },
    },
  },
});

// ─── Model x group matrix (F-010) ───────────────────────────────────────────

/** Months of the synthetic matrix, spend per month and the ungrouped model mix per month. */
const MATRIX_MONTHS: Readonly<
  Record<string, { total: number; mix: Readonly<Record<string, number>> }>
> = {
  '2026-06': {
    total: 18000,
    mix: { 'claude-opus-5': 0.7, 'claude-sonnet-5': 0.26, 'claude-haiku-4-5': 0.04 },
  },
  '2026-07': {
    total: 21000,
    mix: { 'claude-opus-5': 0.64, 'claude-sonnet-5': 0.31, 'claude-haiku-4-5': 0.05 },
  },
  '2026-08': {
    total: 24000,
    mix: { 'claude-opus-5': 0.58, 'claude-sonnet-5': 0.36, 'claude-haiku-4-5': 0.06 },
  },
};

/**
 * Share of a model's spend that is attributed to each group. Members belong to several groups,
 * so every row adds up to more than 1 (the overlap the page warns about); one cell is exactly 0.
 */
const MATRIX_GROUP_SHARES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'claude-opus-5': {
    rbac_group_demo_engineering: 0.78,
    rbac_group_demo_sales: 0.3,
    rbac_group_demo_legal: 0.08,
    rbac_group_demo_pilot: 0.12,
    none: 0.04,
  },
  'claude-sonnet-5': {
    rbac_group_demo_engineering: 0.6,
    rbac_group_demo_sales: 0.4,
    rbac_group_demo_legal: 0.25,
    rbac_group_demo_pilot: 0.05,
    none: 0.05,
  },
  'claude-haiku-4-5': {
    rbac_group_demo_engineering: 0.5,
    rbac_group_demo_sales: 0.3,
    rbac_group_demo_legal: 0,
    rbac_group_demo_pilot: 0.1,
    none: 0.02,
  },
};

/** The synthetic stored input of the matrix collection: 2026-06 .. 2026-08, deterministic. */
export function demoUsageMatrixInput(now: Date): UsageMatrixInput {
  const pairs: MatrixCostRow[] = [];
  const byModel: MatrixCostRow[] = [];
  for (const [month, { total, mix }] of Object.entries(MATRIX_MONTHS)) {
    for (const [model, share] of Object.entries(mix)) {
      const date = `${month}-15`;
      byModel.push({ date, model, group: null, amount: round(total * share), currency: 'USD' });
      for (const [group, groupShare] of Object.entries(MATRIX_GROUP_SHARES[model] ?? {})) {
        const amount = round(total * share * groupShare);
        pairs.push({
          date,
          model,
          group: group === 'none' ? null : group,
          amount,
          currency: 'USD',
        });
      }
    }
  }
  return {
    status: 'ok',
    asOf: '2026-09-29T08:00:00.000Z',
    window: { from: '2026-06-01T00:00:00.000Z', to: now.toISOString() },
    data: aggregateMatrixRows(pairs, byModel),
  };
}
