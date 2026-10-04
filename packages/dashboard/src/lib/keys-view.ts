import type { DetailApiKeys } from '@claude-audit/core/contracts';

export type ApiKey = DetailApiKeys['keys'][number];

/** Primary recommendation for a key, most urgent first (`inactive` keys need no action). */
export type KeyRecommendation =
  'rotate' | 'unused' | 'privileged' | 'rotate_soon' | 'unknown' | 'ok' | 'inactive';
export const KEY_RECOMMENDATIONS: readonly KeyRecommendation[] = [
  'rotate',
  'unused',
  'privileged',
  'rotate_soon',
  'unknown',
  'ok',
  'inactive',
];

export type KeyRecommendationFilter = KeyRecommendation | 'all';
export type KeySortKey = 'name' | 'age' | 'lastSeen' | 'recommendation';
export type SortDirection = 'asc' | 'desc';

/** Display hint, not a compliance rule: "rotate soon" starts at this share of `maxAgeDays`. */
export const ROTATE_SOON_RATIO = 0.8;

const DAY_MS = 86_400_000;

/** Thresholds and reference time taken from the detail file (never the browser clock). */
export interface KeyContext {
  /** File `generatedAt`: the evaluation time the collector used. */
  now: string;
  unusedDays: number;
  maxAgeDays: number;
  usageObservedFrom: string | null;
}

export const keyContext = (
  file: Pick<DetailApiKeys, 'generatedAt' | 'unusedDays' | 'maxAgeDays' | 'usageObservedFrom'>,
): KeyContext => ({
  now: file.generatedAt,
  unusedDays: file.unusedDays,
  maxAgeDays: file.maxAgeDays,
  usageObservedFrom: file.usageObservedFrom,
});

/** Whole days from `from` to `to`, floored; never negative; null for an unparsable date. */
export function daysBetween(from: string, to: string): number | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

export const keyAgeDays = (key: Pick<ApiKey, 'createdAt'>, ctx: KeyContext): number | null =>
  daysBetween(key.createdAt, ctx.now);

/** Mirrors the AK-001 scope set: scopes whose use appears as Compliance API activity. */
export const usesComplianceApi = (scopes: readonly string[]): boolean =>
  scopes.some((s) => s.includes('compliance_') || s === 'read:org_audit');

/** Mirrors the default AK-002 flagged scopes (`write:*`, `delete:*`); see the F-007 notes. */
export const hasWriteScope = (scopes: readonly string[]): boolean =>
  scopes.some((s) => s.startsWith('write:') || s.startsWith('delete:'));

export interface KeyFinding {
  kind: Exclude<KeyRecommendation, 'ok' | 'inactive'> | 'expired';
  detail: string;
}

function ageFinding(key: ApiKey, ctx: KeyContext): KeyFinding | null {
  const age = keyAgeDays(key, ctx);
  if (age === null) return null;
  if (age > ctx.maxAgeDays) {
    return {
      kind: 'rotate',
      detail: `${age} days old, over the ${ctx.maxAgeDays}-day limit (AK-003)`,
    };
  }
  if (age >= Math.ceil(ctx.maxAgeDays * ROTATE_SOON_RATIO)) {
    return {
      kind: 'rotate_soon',
      detail: `${age} days old, ${ctx.maxAgeDays - age} days until the ${ctx.maxAgeDays}-day limit (AK-003)`,
    };
  }
  return null;
}

function usageFinding(key: ApiKey, ctx: KeyContext): KeyFinding | null {
  if (!usesComplianceApi(key.scopes)) return null;
  const idle = key.lastSeenAt ? daysBetween(key.lastSeenAt, ctx.now) : null;
  if (idle !== null) {
    return idle > ctx.unusedDays
      ? {
          kind: 'unused',
          detail: `Not seen for ${idle} days, over the ${ctx.unusedDays}-day limit (AK-001)`,
        }
      : null;
  }
  const observed = ctx.usageObservedFrom ? daysBetween(ctx.usageObservedFrom, ctx.now) : null;
  if (observed !== null && observed >= ctx.unusedDays) {
    return { kind: 'unused', detail: `Not seen in the last ${observed} observed days (AK-001)` };
  }
  return {
    kind: 'unknown',
    detail: `Use cannot be judged yet: usage observed for ${observed ?? 0} of ${ctx.unusedDays} days (AK-001)`,
  };
}

/** All findings for an active key, most urgent first. Deactivated keys have none. */
export function keyFindings(key: ApiKey, ctx: KeyContext): KeyFinding[] {
  if (!key.active) return [];
  const findings: Array<KeyFinding | null> = [
    key.expiresAt && Date.parse(key.expiresAt) < Date.parse(ctx.now)
      ? { kind: 'expired', detail: `Expired on ${key.expiresAt.slice(0, 10)}` }
      : null,
    ageFinding(key, ctx),
    usageFinding(key, ctx),
    hasWriteScope(key.scopes)
      ? { kind: 'privileged', detail: 'Holds write or delete scopes (AK-002)' }
      : null,
  ];
  const order = ['rotate', 'expired', 'unused', 'privileged', 'rotate_soon', 'unknown'];
  return findings
    .filter((f): f is KeyFinding => f !== null)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

export function keyRecommendation(key: ApiKey, ctx: KeyContext): KeyRecommendation {
  if (!key.active) return 'inactive';
  const first = keyFindings(key, ctx)[0];
  if (!first) return 'ok';
  return first.kind === 'expired' ? 'rotate' : first.kind;
}

/** `read:compliance_activities` -> `read: compliance activities`. */
export const scopeLabel = (scope: string): string => scope.replace(/_/g, ' ').replace(':', ': ');

export interface KeyFilter {
  /** Case-insensitive match on name, key id and scopes. */
  query: string;
  recommendation: KeyRecommendationFilter;
}

export function filterKeys(keys: readonly ApiKey[], filter: KeyFilter, ctx: KeyContext): ApiKey[] {
  const query = filter.query.trim().toLowerCase();
  return keys.filter((k) => {
    if (filter.recommendation !== 'all' && keyRecommendation(k, ctx) !== filter.recommendation) {
      return false;
    }
    if (!query) return true;
    return [k.name, k.id, ...k.scopes].some((v) => v.toLowerCase().includes(query));
  });
}

export function countByRecommendation(
  keys: readonly ApiKey[],
  ctx: KeyContext,
): Record<KeyRecommendation, number> {
  const counts = Object.fromEntries(KEY_RECOMMENDATIONS.map((r) => [r, 0])) as Record<
    KeyRecommendation,
    number
  >;
  for (const k of keys) counts[keyRecommendation(k, ctx)] += 1;
  return counts;
}

function compare(a: ApiKey, b: ApiKey, key: KeySortKey, ctx: KeyContext): number {
  switch (key) {
    case 'age':
      // Older keys have the earlier creation date; sort by age, oldest = largest.
      return (keyAgeDays(a, ctx) ?? -1) - (keyAgeDays(b, ctx) ?? -1);
    case 'lastSeen':
      // Keys never seen sort as the oldest.
      return (a.lastSeenAt ?? '').localeCompare(b.lastSeenAt ?? '');
    case 'recommendation':
      return (
        KEY_RECOMMENDATIONS.indexOf(keyRecommendation(a, ctx)) -
        KEY_RECOMMENDATIONS.indexOf(keyRecommendation(b, ctx))
      );
    default:
      return a.name.localeCompare(b.name);
  }
}

/** Stable sort; ties fall back to the (masked) id so the order is deterministic. */
export function sortKeys(
  keys: readonly ApiKey[],
  key: KeySortKey,
  direction: SortDirection,
  ctx: KeyContext,
): ApiKey[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...keys].sort((a, b) => sign * compare(a, b, key, ctx) || a.id.localeCompare(b.id));
}
