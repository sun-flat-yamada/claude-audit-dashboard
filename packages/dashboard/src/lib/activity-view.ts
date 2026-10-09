import type { DetailActivity, DetailManifest } from '@claude-audit/core/contracts';

export type ActivityItem = DetailActivity['items'][number];

/** Timeline rows per page. */
export const ACTIVITY_PAGE_SIZE = 50;

export interface ActivityFilter {
  /** Case-insensitive match on type, actor id / e-mail / IP and organization. */
  query: string;
  /** Exact activity type, or `all`. */
  type: string;
  /** Exact actor kind, or `all`. */
  actorKind: string;
  /** Inclusive UTC day `yyyy-mm-dd`, or empty. */
  from: string;
  to: string;
  /** Rule-match filter: 'all', 'any' (any watch match), or rule ID ('AM-001'..). */
  rule: string;
}

export const NO_ACTIVITY_FILTER: ActivityFilter = {
  query: '',
  type: 'all',
  actorKind: 'all',
  from: '',
  to: '',
  rule: 'all',
};

export interface ActivityRuleDef {
  id: string;
  name: string;
  types: readonly string[];
}

export const ACTIVITY_RULES: readonly ActivityRuleDef[] = [
  {
    id: 'AM-001',
    name: 'Privileged Role Changes',
    types: [
      'primary_owner_transferred',
      'rbac_role_assigned',
      'rbac_role_permission_added',
      'role_assignment_granted',
      'claude_user_role_updated',
    ],
  },
  {
    id: 'AM-002',
    name: 'Identity Provider Changes',
    types: [
      'org_sso_toggled',
      'org_sso_connection_deactivated',
      'org_sso_connection_deleted',
      'org_sso_provisioning_mode_changed',
      'org_sso_group_role_mappings_updated',
      'org_directory_sync_deleted',
    ],
  },
  {
    id: 'AM-003',
    name: 'Network Restriction Changes',
    types: [
      'org_ip_restriction_created',
      'org_ip_restriction_updated',
      'org_ip_restriction_deleted',
    ],
  },
  {
    id: 'AM-004',
    name: 'API Key Lifecycle',
    types: ['api_key_created', 'api_key_deleted'],
  },
  {
    id: 'AM-005',
    name: 'Export Activity',
    types: ['export_completed', 'audit_export_requested', 'export_created'],
  },
  {
    id: 'AM-006',
    name: 'Authentication Failure Burst',
    types: ['user_login_failed'],
  },
  {
    id: 'AM-007',
    name: 'Data Protection Changes',
    types: [
      'data_retention_policy_updated',
      'data_export_policy_updated',
      'retention_policy_updated',
    ],
  },
];

export function matchActivityRules(item: ActivityItem): string[] {
  return ACTIVITY_RULES.filter((rule) => rule.types.includes(item.type)).map((r) => r.id);
}

export interface ActivityMonth {
  month: string;
  count: number | null;
}

/** Months the manifest offers (status ok), newest first. */
export function activityMonths(manifest: DetailManifest): ActivityMonth[] {
  return manifest.files
    .filter((f) => f.kind === 'activity' && f.status === 'ok' && f.month !== null)
    .map((f) => ({ month: f.month as string, count: f.count }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

/** Reason of an `unavailable` activity entry (dataset not collected), or null. */
export function activityUnavailable(manifest: DetailManifest): { reason: string | null } | null {
  const entry = manifest.files.find((f) => f.kind === 'activity' && f.status === 'unavailable');
  return entry ? { reason: entry.reason } : null;
}

function matchesRule(item: ActivityItem, rule: ActivityRuleFilter): boolean {
  if (!rule || rule === 'all') return true;
  const matches = matchActivityRules(item);
  if (rule === 'any') return matches.length > 0;
  return matches.includes(rule);
}

function matchesDate(day: string, from: string, to: string): boolean {
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function matchesQuery(item: ActivityItem, query: string): boolean {
  if (!query) return true;
  return [item.type, item.actor.id, item.actor.email, item.actor.ip, item.organizationId].some(
    (value) => value?.toLowerCase().includes(query),
  );
}

export function filterActivity(
  items: readonly ActivityItem[],
  filter: ActivityFilter,
): ActivityItem[] {
  const query = filter.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter.type !== 'all' && item.type !== filter.type) return false;
    if (filter.actorKind !== 'all' && item.actor.kind !== filter.actorKind) return false;
    if (!matchesRule(item, filter.rule)) return false;
    if (!matchesDate(item.createdAt.slice(0, 10), filter.from, filter.to)) return false;
    return matchesQuery(item, query);
  });
}

export const uniqueTypes = (items: readonly ActivityItem[]): string[] =>
  [...new Set(items.map((i) => i.type))].sort();

export const uniqueActorKinds = (items: readonly ActivityItem[]): string[] =>
  [...new Set(items.map((i) => i.actor.kind))].sort();

export const pageCount = (total: number, size = ACTIVITY_PAGE_SIZE): number =>
  Math.max(1, Math.ceil(total / size));

/** `page` is 1-based and clamped to the available pages. */
export function pageSlice<T>(rows: readonly T[], page: number, size = ACTIVITY_PAGE_SIZE): T[] {
  const current = Math.min(Math.max(1, page), pageCount(rows.length, size));
  return rows.slice((current - 1) * size, current * size);
}

const ACTOR_KINDS: Record<string, string> = {
  user_actor: 'User',
  api_actor: 'API key',
  unauthenticated_user_actor: 'Unauthenticated',
  anthropic_actor: 'Anthropic',
  scim_directory_sync_actor: 'Directory sync',
  admin_api_key_actor: 'Admin API key',
};

/** Key of the `StatusBadge` entry for an actor kind (unknown kinds share `actor-other`). */
export const actorBadge = (kind: string): string =>
  kind in ACTOR_KINDS ? `actor-${kind}` : 'actor-other';

/** Known actor kinds get a short label; others are shown humanized, never dropped. */
export function actorKindLabel(kind: string): string {
  const known = ACTOR_KINDS[kind];
  if (known) return known;
  const text = kind
    .replace(/_actor$/, '')
    .replace(/_/g, ' ')
    .trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown';
}

/** `claude_chat_created` -> `claude chat created`. */
export const typeLabel = (type: string): string => type.replace(/_/g, ' ');

/** `2026-09` -> `September 2026` (English, UTC). */
export function monthLabel(month: string): string {
  const [year, mm] = month.split('-');
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${names[Number(mm) - 1] ?? mm} ${year}`;
}

/** Last day `yyyy-mm-dd` of a `yyyy-mm` month (UTC). */
export function monthEnd(month: string): string {
  const [year, mm] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year ?? 1970, mm ?? 1, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

export interface DailyCount {
  date: string;
  day: number;
  count: number;
}

/** Aggregates daily activity counts for a month; all calendar days are populated (count 0 when no events). */
export function dailyActivityCounts(
  items: readonly ActivityItem[],
  month: string,
): readonly DailyCount[] {
  if (!month) return [];
  const [year, mm] = month.split('-').map(Number);
  const totalDays = new Date(Date.UTC(year ?? 1970, mm ?? 1, 0)).getUTCDate();
  const map = new Map<string, number>();
  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    map.set(dateStr, 0);
  }
  for (const item of items) {
    const d = item.createdAt.slice(0, 10);
    if (map.has(d)) {
      map.set(d, (map.get(d) ?? 0) + 1);
    }
  }
  return [...map.entries()].map(([date, count]) => ({
    date,
    day: Number(date.slice(8, 10)),
    count,
  }));
}

export interface ActivityRouteState {
  month: string;
  filter: ActivityFilter;
  page: number;
}

function parsePage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function parseMonth(month: string | undefined, months: readonly string[]): string {
  return month && months.includes(month) ? month : (months[0] ?? '');
}

export function parseActivityQuery(
  query: Record<string, string>,
  months: readonly string[],
): ActivityRouteState {
  return {
    month: parseMonth(query.month, months),
    page: parsePage(query.page),
    filter: {
      query: query.q ?? '',
      type: query.type || 'all',
      actorKind: query.actorKind || 'all',
      from: query.from ?? '',
      to: query.to ?? '',
      rule: query.rule || 'all',
    },
  };
}

function appendFilterQuery(target: Record<string, string>, filter: ActivityFilter): void {
  if (filter.query) target.q = filter.query;
  if (filter.type && filter.type !== 'all') target.type = filter.type;
  if (filter.actorKind && filter.actorKind !== 'all') target.actorKind = filter.actorKind;
  if (filter.from) target.from = filter.from;
  if (filter.to) target.to = filter.to;
  if (filter.rule && filter.rule !== 'all') target.rule = filter.rule;
}

export function formatActivityQuery(
  state: ActivityRouteState,
  defaultMonth: string,
): Record<string, string> {
  const query: Record<string, string> = {};
  if (state.month && state.month !== defaultMonth) query.month = state.month;
  appendFilterQuery(query, state.filter);
  if (state.page > 1) query.page = String(state.page);
  return query;
}
