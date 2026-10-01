import {
  missingRequirements,
  withDefaults,
  type DatasetMap,
  type DatasetName,
} from '../model/dataset.js';
import type { CostRow } from '../model/entities.js';
import { inputTokens } from '../model/metrics.js';
import type { AuditSnapshot } from '../model/snapshot.js';
import { sortedByValue, sumBy, totalsBy } from '../util/collections.js';
import { percent } from '../util/numbers.js';

export interface Insight {
  id: string;
  kind: 'recommendation' | 'observation';
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  metrics: Record<string, number>;
}

/** Derives insights (not pass/fail checks) from a snapshot. Pure; declares its data needs. */
export interface Analyzer {
  readonly id: string;
  readonly requires: readonly DatasetName[];
  analyze(data: DatasetMap): Insight[];
}

const costShares = (rows: readonly CostRow[], dimension: CostRow['dimension']) => {
  const scoped = rows.filter((r) => r.dimension === dimension && r.key !== null);
  const total = sumBy(
    rows.filter((r) => r.dimension === 'total'),
    (r) => r.amount,
  );
  return {
    total,
    ranked: sortedByValue(
      totalsBy(
        scoped,
        (r) => r.key ?? '',
        (r) => r.amount,
      ),
    ),
  };
};

export const modelConcentration: Analyzer = {
  id: 'model-concentration',
  requires: ['cost'],
  analyze(data) {
    const { total, ranked } = costShares(data.cost, 'model');
    const [top] = ranked;
    if (!top || total === 0 || percent(top[1], total) <= 60) return [];
    return [
      {
        id: 'model-concentration',
        kind: 'recommendation',
        priority: 'medium',
        title: `${top[0]} accounts for ${percent(top[1], total)}% of spend`,
        detail: 'Review whether routine tasks can be routed to a smaller, cheaper model.',
        metrics: { share: percent(top[1], total), models: ranked.length },
      },
    ];
  },
};

export const cacheEfficiency: Analyzer = {
  id: 'cache-efficiency',
  requires: ['usage'],
  analyze(data) {
    const rows = data.usage.filter((r) => r.dimension === 'total');
    const input = sumBy(rows, inputTokens);
    const cached = sumBy(rows, (r) => r.cacheReadInputTokens);
    if (input < 1_000_000 || percent(cached, input) >= 30) return [];
    return [
      {
        id: 'cache-efficiency',
        kind: 'recommendation',
        priority: 'low',
        title: `Only ${percent(cached, input)}% of input tokens were cache reads`,
        detail:
          'Long, repeated context (projects, system prompts, tools) benefits from prompt caching.',
        metrics: { cacheReadShare: percent(cached, input), inputTokens: input },
      },
    ];
  },
};

export const groupConcentration: Analyzer = {
  id: 'group-concentration',
  requires: ['cost'],
  analyze(data) {
    const { total, ranked } = costShares(data.cost, 'group');
    const [top] = ranked;
    if (!top || total === 0 || percent(top[1], total) <= 80) return [];
    return [
      {
        id: 'group-concentration',
        kind: 'observation',
        priority: 'low',
        title: `One group accounts for ${percent(top[1], total)}% of spend`,
        detail:
          'Group rows count a member in every group they belong to, so shares can overlap; confirm the allocation before charge-back.',
        metrics: { share: percent(top[1], total) },
      },
    ];
  },
};

export const seatUtilization: Analyzer = {
  id: 'seat-utilization',
  requires: ['adoption'],
  analyze(data) {
    const latest = [...data.adoption].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    const rate = latest?.monthlyAdoptionRate;
    if (!latest || rate === null || rate === undefined || rate >= 50) return [];
    return [
      {
        id: 'seat-utilization',
        kind: 'recommendation',
        priority: 'medium',
        title: `Only ${rate}% of assigned seats were active in the last 30 days`,
        detail:
          'Reclaim unused seats or plan enablement for teams that have not adopted Claude yet.',
        metrics: { monthlyAdoptionRate: rate, assignedSeats: latest.assignedSeats ?? 0 },
      },
    ];
  },
};

export const BUILTIN_ANALYZERS: readonly Analyzer[] = [
  modelConcentration,
  cacheEfficiency,
  groupConcentration,
  seatUtilization,
];

/** Runs analyzers whose required datasets were collected; the others are skipped silently. */
export const runAnalyzers = (
  analyzers: readonly Analyzer[],
  snapshot: AuditSnapshot,
): Insight[] => {
  const data = withDefaults(snapshot.data);
  return analyzers
    .filter((a) => missingRequirements(a.requires, snapshot.coverage) === null)
    .flatMap((a) => a.analyze(data));
};
