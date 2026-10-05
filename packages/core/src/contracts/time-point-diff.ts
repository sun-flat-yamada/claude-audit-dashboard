import type {
  DatasetStatusValue,
  RuleStatus,
  TimePointKpi,
  TimePointSummary,
} from './time-point-summary.js';

/**
 * Pure comparison of two time-point summaries (F-015). No I/O, no clock: the result is a
 * function of the two inputs, so the dashboard computes it in the browser and the collector
 * tests can assert it.
 *
 * Rule status ranks: `pass` < `warning` < `fail` are ASSESSED (the rule produced a verdict);
 * `skipped` and `error` are NOT assessed. Classification of a rule present at both points:
 *
 * - same status: `unchanged`
 * - assessed -> assessed: `regressed` when the rank rises, `improved` when it falls
 * - not assessed -> assessed: `assessed` (the rule gained a verdict)
 * - assessed -> not assessed: `unassessed` (the rule lost its verdict)
 * - skipped -> error: `regressed`; error -> skipped: `improved` (an error is worse than a skip
 *   for missing data, although neither is assessed)
 *
 * A rule only at the target is `added`, only at the base `removed` (a rule switched off or
 * introduced between the points).
 */
export type ChangeClass =
  'regressed' | 'improved' | 'unchanged' | 'added' | 'removed' | 'assessed' | 'unassessed';

/** Every class, in the order the diff lists changes (most important first). */
export const CHANGE_CLASSES: readonly ChangeClass[] = [
  'regressed',
  'unassessed',
  'added',
  'removed',
  'assessed',
  'improved',
  'unchanged',
];

const STATUS_RANK: Record<RuleStatus, { assessed: boolean; rank: number }> = {
  pass: { assessed: true, rank: 0 },
  warning: { assessed: true, rank: 1 },
  fail: { assessed: true, rank: 2 },
  skipped: { assessed: false, rank: 0 },
  error: { assessed: false, rank: 1 },
};

/** Classifies the change of one rule between two statuses (see the table above). */
export function classifyStatusChange(from: RuleStatus, to: RuleStatus): ChangeClass {
  if (from === to) return 'unchanged';
  const before = STATUS_RANK[from];
  const after = STATUS_RANK[to];
  if (before.assessed !== after.assessed) return after.assessed ? 'assessed' : 'unassessed';
  return after.rank > before.rank ? 'regressed' : 'improved';
}

const COVERAGE_RANK: Record<DatasetStatusValue, number> = { ok: 0, unavailable: 1, error: 2 };

/** Dataset status change: `ok` < `unavailable` < `error`; a worse status is `regressed`. */
export function classifyCoverageChange(
  from: DatasetStatusValue,
  to: DatasetStatusValue,
): ChangeClass {
  if (from === to) return 'unchanged';
  return COVERAGE_RANK[to] > COVERAGE_RANK[from] ? 'regressed' : 'improved';
}

export interface RuleChange {
  id: string;
  name: string;
  category: string;
  /** Severity at the target (at the base for a removed rule). */
  severity: string;
  /** Null for an added rule. */
  from: RuleStatus | null;
  /** Null for a removed rule. */
  to: RuleStatus | null;
  change: Exclude<ChangeClass, 'unchanged'>;
}

export interface CoverageChange {
  dataset: string;
  /** Null when the dataset is only at the target (added). */
  from: DatasetStatusValue | null;
  /** Null when the dataset is only at the base (removed). */
  to: DatasetStatusValue | null;
  fromCount: number | null;
  toCount: number | null;
  /** `toCount - fromCount`, null when either count is unknown. */
  countDelta: number | null;
  change: Exclude<ChangeClass, 'unchanged' | 'assessed' | 'unassessed'>;
}

export interface KpiDelta {
  id: string;
  label: string;
  unit: TimePointKpi['unit'];
  base: number | null;
  target: number | null;
  /** `target - base` (two decimals), null when either value is missing. */
  delta: number | null;
}

export interface ScoreDelta {
  base: number;
  target: number;
  delta: number;
  baseAssessed: number;
  targetAssessed: number;
  /** Change of the assessed-rule count; a score moves with it when rules lose or gain a verdict. */
  assessedDelta: number;
  baseTotal: number;
  targetTotal: number;
}

export type ChangeCounts = Record<ChangeClass, number>;

export interface TimePointDiff {
  base: { id: string; collectedAt: string };
  target: { id: string; collectedAt: string };
  score: ScoreDelta;
  rules: {
    /** Every rule whose class is not `unchanged`, most important first. */
    changes: RuleChange[];
    counts: ChangeCounts;
  };
  coverage: {
    /** Datasets whose status differs or that exist at one point only. */
    changes: CoverageChange[];
    counts: ChangeCounts;
  };
  /** Target order, then KPIs only at the base. */
  kpis: KpiDelta[];
  /** False when nothing at all differs (identical summaries). */
  hasChanges: boolean;
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

const severityIndex = (severity: string): number => {
  const index = SEVERITY_ORDER.indexOf(severity);
  return index === -1 ? SEVERITY_ORDER.length : index;
};

const classIndex = (change: ChangeClass): number => CHANGE_CLASSES.indexOf(change);

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const emptyCounts = (): ChangeCounts => ({
  regressed: 0,
  improved: 0,
  unchanged: 0,
  added: 0,
  removed: 0,
  assessed: 0,
  unassessed: 0,
});

const tally = (classes: readonly ChangeClass[]): ChangeCounts => {
  const counts = emptyCounts();
  for (const change of classes) counts[change] += 1;
  return counts;
};

const toMap = <T extends { id: string }>(items: readonly T[]): Map<string, T> =>
  new Map(items.map((item) => [item.id, item]));

/** `added` / `removed` for an item at one point only, else the classification of the pair. */
function pairClass<T>(
  base: T | undefined,
  target: T | undefined,
  classify: (before: T, after: T) => ChangeClass,
): ChangeClass {
  if (base !== undefined && target !== undefined) return classify(base, target);
  return target === undefined ? 'removed' : 'added';
}

type RuleRow = TimePointSummary['rules'][number];

function ruleChange(
  base: RuleRow | undefined,
  target: RuleRow | undefined,
): { change: ChangeClass; row: RuleChange | null } {
  const change = pairClass(base, target, (b, t) => classifyStatusChange(b.status, t.status));
  const rule = target ?? base;
  if (!rule || change === 'unchanged') return { change, row: null };
  return {
    change,
    row: {
      id: rule.id,
      name: rule.name,
      category: rule.category,
      severity: rule.severity,
      from: base?.status ?? null,
      to: target?.status ?? null,
      change: change as RuleChange['change'],
    },
  };
}

function diffRules(base: TimePointSummary, target: TimePointSummary): TimePointDiff['rules'] {
  const before = toMap(base.rules);
  const after = toMap(target.rules);
  const ids = [...new Set([...before.keys(), ...after.keys()])];
  const results = ids.map((id) => ruleChange(before.get(id), after.get(id)));
  const changes = results
    .flatMap((r) => (r.row ? [r.row] : []))
    .sort(
      (a, b) =>
        classIndex(a.change) - classIndex(b.change) ||
        severityIndex(a.severity) - severityIndex(b.severity) ||
        byCode(a.id, b.id),
    );
  return { changes, counts: tally(results.map((r) => r.change)) };
}

type DatasetRow = TimePointSummary['datasets'][number];

const countDelta = (from: number | null, to: number | null): number | null =>
  from === null || to === null ? null : to - from;

function coverageChange(
  dataset: string,
  base: DatasetRow | undefined,
  target: DatasetRow | undefined,
): { change: ChangeClass; row: CoverageChange | null } {
  const change = pairClass(base, target, (b, t) => classifyCoverageChange(b.status, t.status));
  if (change === 'unchanged') return { change, row: null };
  const fromCount = base?.count ?? null;
  const toCount = target?.count ?? null;
  return {
    change,
    row: {
      dataset,
      from: base?.status ?? null,
      to: target?.status ?? null,
      fromCount,
      toCount,
      countDelta: countDelta(fromCount, toCount),
      change: change as CoverageChange['change'],
    },
  };
}

function diffCoverage(base: TimePointSummary, target: TimePointSummary): TimePointDiff['coverage'] {
  const before = new Map(base.datasets.map((d) => [d.name, d]));
  const after = new Map(target.datasets.map((d) => [d.name, d]));
  const names = [...new Set([...before.keys(), ...after.keys()])];
  const results = names.map((name) => coverageChange(name, before.get(name), after.get(name)));
  const changes = results
    .flatMap((r) => (r.row ? [r.row] : []))
    .sort((a, b) => classIndex(a.change) - classIndex(b.change) || byCode(a.dataset, b.dataset));
  return { changes, counts: tally(results.map((r) => r.change)) };
}

const delta = (base: number | null, target: number | null): number | null =>
  base === null || target === null ? null : Number((target - base).toFixed(2));

function diffKpis(base: TimePointSummary, target: TimePointSummary): KpiDelta[] {
  const before = toMap(base.kpis);
  const after = toMap(target.kpis);
  const ids = [...new Set([...target.kpis.map((k) => k.id), ...base.kpis.map((k) => k.id)])];
  return ids.map((id) => {
    const b = before.get(id);
    const t = after.get(id);
    const kpi = (t ?? b) as TimePointKpi;
    return {
      id,
      label: kpi.label,
      unit: kpi.unit,
      base: b?.value ?? null,
      target: t?.value ?? null,
      delta: delta(b?.value ?? null, t?.value ?? null),
    };
  });
}

function diffScore(base: TimePointSummary, target: TimePointSummary): ScoreDelta {
  return {
    base: base.score,
    target: target.score,
    delta: target.score - base.score,
    baseAssessed: base.assessed,
    targetAssessed: target.assessed,
    assessedDelta: target.assessed - base.assessed,
    baseTotal: base.total,
    targetTotal: target.total,
  };
}

const kpiChanged = (k: KpiDelta): boolean => k.base !== k.target;

/**
 * What changed from `base` (earlier) to `target` (later): rule changes by class, dataset
 * coverage changes, KPI deltas and the score delta next to the change of the assessed count.
 * Neither argument is modified; the same two summaries always give the same diff.
 */
export function diffTimePoints(base: TimePointSummary, target: TimePointSummary): TimePointDiff {
  const rules = diffRules(base, target);
  const coverage = diffCoverage(base, target);
  const kpis = diffKpis(base, target);
  const score = diffScore(base, target);
  return {
    base: { id: base.id, collectedAt: base.collectedAt },
    target: { id: target.id, collectedAt: target.collectedAt },
    score,
    rules,
    coverage,
    kpis,
    hasChanges:
      rules.changes.length > 0 ||
      coverage.changes.length > 0 ||
      kpis.some(kpiChanged) ||
      score.delta !== 0 ||
      score.assessedDelta !== 0,
  };
}
