import type {
  DashboardCheckResult,
  DashboardKpi,
  DashboardUsage,
} from '@claude-audit/core/contracts';
import { formatCompact, formatInteger, formatMoneyHeadline, formatPercent } from './format';

/** Pure view helpers: everything the components derive from the published contract lives here. */

const STATUS_RANK: Record<string, number> = { fail: 0, error: 1, warning: 2, skipped: 3, pass: 4 };
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const rank = (table: Record<string, number>, key: string): number =>
  table[key] ?? Object.keys(table).length;

/** Failing first, then by severity, then by rule id (stable across runs). */
export const sortResults = (results: readonly DashboardCheckResult[]): DashboardCheckResult[] =>
  [...results].sort(
    (a, b) =>
      rank(STATUS_RANK, a.status) - rank(STATUS_RANK, b.status) ||
      rank(SEVERITY_RANK, a.severity) - rank(SEVERITY_RANK, b.severity) ||
      a.ruleId.localeCompare(b.ruleId),
  );

export const STATUS_FILTERS = ['all', 'fail', 'warning', 'error', 'skipped', 'pass'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const filterResults = (
  results: readonly DashboardCheckResult[],
  filter: StatusFilter,
): DashboardCheckResult[] => results.filter((r) => filter === 'all' || r.status === filter);

export const countByStatus = (
  results: readonly DashboardCheckResult[],
): Record<StatusFilter, number> =>
  Object.fromEntries(STATUS_FILTERS.map((f) => [f, filterResults(results, f).length])) as Record<
    StatusFilter,
    number
  >;

const KPI_FORMAT: Record<DashboardKpi['unit'], (value: number, hint: string | null) => string> = {
  score: (value) => formatInteger(value),
  count: (value) => (value >= 10_000 ? formatCompact(value) : formatInteger(value)),
  currency: (value, currency) => formatMoneyHeadline(value, currency ?? 'USD'),
  percent: (value) => formatPercent(value),
};

/** Stat-tile value: auto-compact, em dash when the dataset was not collected. */
export const formatKpi = (kpi: DashboardKpi): string =>
  kpi.value === null ? '—' : KPI_FORMAT[kpi.unit](kpi.value, kpi.hint);

const ACRONYMS = /\b(api|ip|sso|scim|rbac|mcp)\b/gi;

/** `api-key-management` -> `API key management`. */
export const humanize = (id: string): string => {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return (words.charAt(0).toUpperCase() + words.slice(1)).replace(ACRONYMS, (w) => w.toUpperCase());
};

export interface TokenSeries {
  key: string;
  label: string;
  color: string;
}

/**
 * Output sits before cache write so that the two lines that usually run close together
 * (cache read and output) get the orange / aqua slots instead of the weaker orange / yellow pair.
 */
export const TOKEN_TYPES: readonly TokenSeries[] = [
  { key: 'uncachedInputTokens', label: 'Uncached input', color: 'var(--series-1)' },
  { key: 'cacheReadInputTokens', label: 'Cache read', color: 'var(--series-2)' },
  { key: 'outputTokens', label: 'Output', color: 'var(--series-3)' },
  { key: 'cacheCreationInputTokens', label: 'Cache write', color: 'var(--series-4)' },
];

const LEGACY_TOKENS: readonly TokenSeries[] = [
  { key: 'inputTokens', label: 'Input tokens', color: 'var(--series-1)' },
  { key: 'outputTokens', label: 'Output tokens', color: 'var(--series-2)' },
];

/** True when every day carries the input breakdown (a `dashboard.json` from before AN-1 has none). */
export const hasTokenBreakdown = (daily: DashboardUsage['daily']): boolean =>
  daily.length > 0 &&
  daily.every(
    (d) =>
      d.uncachedInputTokens !== undefined &&
      d.cacheReadInputTokens !== undefined &&
      d.cacheCreationInputTokens !== undefined,
  );

/** Token chart series by type, or the summed input / output pair for an older view. */
export const tokenSeries = (daily: DashboardUsage['daily']): readonly TokenSeries[] =>
  hasTokenBreakdown(daily) ? TOKEN_TYPES : LEGACY_TOKENS;

/** Subtitle of the token card: the period cache hit rate when the view carries one. */
export const tokenSubtitle = (usage: DashboardUsage): string => {
  const rate = usage.cacheHitRate;
  const hit =
    rate === undefined
      ? null
      : `Cache hit rate ${rate === null ? '—' : formatPercent(rate)} (cache reads ÷ all input)`;
  const base = hasTokenBreakdown(usage.daily)
    ? 'Tokens per day by type'
    : 'Input includes cache reads and writes';
  return hit ? `${base} · ${hit}` : base;
};
