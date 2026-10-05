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
}

export const NO_ACTIVITY_FILTER: ActivityFilter = {
  query: '',
  type: 'all',
  actorKind: 'all',
  from: '',
  to: '',
};

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

export function filterActivity(
  items: readonly ActivityItem[],
  filter: ActivityFilter,
): ActivityItem[] {
  const query = filter.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter.type !== 'all' && item.type !== filter.type) return false;
    if (filter.actorKind !== 'all' && item.actor.kind !== filter.actorKind) return false;
    const day = item.createdAt.slice(0, 10);
    if (filter.from && day < filter.from) return false;
    if (filter.to && day > filter.to) return false;
    if (!query) return true;
    return [item.type, item.actor.id, item.actor.email, item.actor.ip, item.organizationId].some(
      (value) => value?.toLowerCase().includes(query),
    );
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
