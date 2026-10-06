import {
  CHANGE_CLASSES,
  type ChangeClass,
  type ComparePoint,
  type KpiDelta,
  type RuleChange,
  type TimePointSummary,
} from '@claude-audit/core/contracts';
import { formatInteger, formatMoney, formatPercent } from './format';

/** Pure helpers of the compare page (F-015): selection, rule-change filtering, figures. */

/** Points that have a summary file, newest first (the index order). */
export const selectablePoints = (points: readonly ComparePoint[]): ComparePoint[] =>
  points.filter((p) => p.state === 'summary');

export type PointCheck =
  | { status: 'ok'; point: ComparePoint }
  | { status: 'unknown'; id: string }
  | { status: 'archived'; point: ComparePoint };

/** Looks an id up in the index: selectable, archived without a summary, or unknown. */
export function checkPoint(points: readonly ComparePoint[], id: string): PointCheck {
  const point = points.find((p) => p.id === id);
  if (!point) return { status: 'unknown', id };
  return point.state === 'summary' ? { status: 'ok', point } : { status: 'archived', point };
}

/**
 * The selection shown: an explicit id from the query wins (even when invalid, so the page can
 * say so); otherwise the target is the newest selectable point other than an explicit base, and
 * the base the point just before the target (the next older one, or the next newer one when the
 * target is the oldest).
 */
export function defaultSelection(
  points: readonly ComparePoint[],
  query: { base?: string | undefined; target?: string | undefined },
): { base: string; target: string } {
  const list = selectablePoints(points);
  const target = query.target || list.find((p) => p.id !== query.base)?.id || '';
  const at = list.findIndex((p) => p.id === target);
  const previous = list[at + 1] ?? list.filter((p) => p.id !== target)[0];
  return { base: query.base || previous?.id || '', target };
}

export const CHANGE_LABEL: Record<ChangeClass | 'all', string> = {
  all: 'All changes',
  regressed: 'Regressed',
  improved: 'Improved',
  added: 'Added',
  removed: 'Removed',
  assessed: 'Now assessed',
  unassessed: 'No longer assessed',
  unchanged: 'Unchanged',
};

/** Filter chip order: everything that changed, the classes by importance, then unchanged. */
export const RULE_FILTERS = ['all', ...CHANGE_CLASSES] as const;
export type RuleFilter = (typeof RULE_FILTERS)[number];

export type RuleRow = Omit<RuleChange, 'change'> & { change: ChangeClass };

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const severityRank = (s: string): number => {
  const i = SEVERITIES.indexOf(s);
  return i === -1 ? SEVERITIES.length : i;
};

/** Rules present at both points with the same status, most severe first. */
export function unchangedRules(base: TimePointSummary, target: TimePointSummary): RuleRow[] {
  const before = new Map(base.rules.map((r) => [r.id, r.status]));
  return target.rules
    .filter((r) => before.get(r.id) === r.status)
    .map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      severity: r.severity,
      from: r.status,
      to: r.status,
      change: 'unchanged' as const,
    }))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || (a.id < b.id ? -1 : 1));
}

/** Rows for a chip: `all` is every changed rule (not the unchanged ones), then the search. */
export function filterRuleRows(
  changes: readonly RuleRow[],
  unchanged: readonly RuleRow[],
  filter: RuleFilter,
  query: string,
): RuleRow[] {
  const rows =
    filter === 'all' ? changes : [...changes, ...unchanged].filter((row) => row.change === filter);
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...rows];
  return rows.filter((row) =>
    [row.id, row.name, row.category, row.severity].some((v) => v.toLowerCase().includes(needle)),
  );
}

/** Chip counts: `all` shown by the chip is the number of changed rules. */
export function changedTotal(counts: Record<ChangeClass, number>): number {
  return CHANGE_CLASSES.filter((c) => c !== 'unchanged').reduce((n, c) => n + counts[c], 0);
}

const sign = (value: number): string => (value > 0 ? '+' : value < 0 ? '−' : '');

const plain = (value: number): string =>
  Number.isInteger(value)
    ? formatInteger(value)
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);

/** A KPI value with its unit; `–` when the point does not have it. */
export function formatKpiValue(unit: KpiDelta['unit'], value: number | null, currency = 'USD') {
  if (value === null) return '–';
  if (unit === 'currency') return formatMoney(value, currency);
  if (unit === 'percent') return formatPercent(value);
  return plain(value);
}

/** A signed KPI delta (`+3`, `−$120`, `+2.0 pp`); `–` when it cannot be computed. */
export function formatKpiDelta(unit: KpiDelta['unit'], delta: number | null, currency = 'USD') {
  if (delta === null) return '–';
  if (delta === 0) return '0';
  const magnitude = Math.abs(delta);
  if (unit === 'currency') return `${sign(delta)}${formatMoney(magnitude, currency)}`;
  if (unit === 'percent') return `${sign(delta)}${magnitude.toFixed(1)} pp`;
  return `${sign(delta)}${plain(magnitude)}`;
}

/** A signed integer-style delta of a count or score (`+5`, `−2`, `0`). */
export function formatDelta(delta: number): string {
  return delta === 0 ? '0' : `${sign(delta)}${plain(Math.abs(delta))}`;
}

/** `2026-09-01T12-00-00Z` -> `2026-09-01 12:00 UTC`; anything else is shown as given. */
export function formatPointId(id: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-\d{2}Z$/.exec(id);
  return m ? `${m[1]} ${m[2]}:${m[3]} UTC` : id;
}

/** Option text of a point: time, score and assessed count; archived points say why they are off. */
export function pointLabel(point: ComparePoint): string {
  const when = formatPointId(point.id);
  if (point.state === 'archived') return `${when} (archived, no summary)`;
  return point.score === null ? when : `${when} · score ${plain(point.score)}`;
}
