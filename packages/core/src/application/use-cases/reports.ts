import type { Insight } from '../../domain/analysis/analyzers.js';
import { formatScore } from '../../domain/compliance/scoring.js';
import type { ComplianceReport } from '../../domain/compliance/types.js';
import { withDefaults, type DatasetMap, type DatasetName } from '../../domain/model/dataset.js';
import type { CostRow, UsageDimension } from '../../domain/model/entities.js';
import { inputTokens } from '../../domain/model/metrics.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import {
  countBy,
  sortedByValue,
  sumBy,
  totalsBy,
  uniqueBy,
} from '../../domain/util/collections.js';
import { percent, round } from '../../domain/util/numbers.js';
import {
  addDays,
  monthKey,
  monthRange,
  previousMonth,
  startOfUtcDay,
  toIsoDate,
  type DateRange,
} from '../../domain/util/time.js';
import {
  formatInteger,
  formatMoney,
  formatPercent,
  type ReportDocument,
  type Section,
} from '../documents.js';

export interface ReportContext {
  now: Date;
  period: DateRange;
  /** Latest stored snapshot, or the data collected live for `liveDatasets`. */
  snapshot: AuditSnapshot | null;
  /** Stored snapshots collected inside the period, oldest first. */
  snapshots: readonly AuditSnapshot[];
  compliance: ComplianceReport | null;
  complianceHistory: readonly ComplianceReport[];
  insights: readonly Insight[];
}

export interface ReportDefinition {
  readonly id: string;
  readonly description: string;
  /** Datasets collected live for the period; empty means stored snapshots are used. */
  readonly liveDatasets: readonly DatasetName[];
  period(now: Date, argument?: string): DateRange;
  build(context: ReportContext): ReportDocument;
}

const dataOf = (snapshot: AuditSnapshot | null): DatasetMap => withDefaults(snapshot?.data ?? {});

const inPeriod = (date: string, period: DateRange): boolean =>
  date >= toIsoDate(period.start) && date < toIsoDate(period.end);

const currencyOf = (rows: readonly CostRow[]): string => rows[0]?.currency ?? 'USD';

function costBreakdown(
  title: string,
  rows: readonly CostRow[],
  dimension: UsageDimension,
  labels: ReadonlyMap<string, string> = new Map(),
): Section {
  const total = sumBy(
    rows.filter((r) => r.dimension === 'total'),
    (r) => r.amount,
  );
  const scoped = rows.filter((r) => r.dimension === dimension);
  const ranked = sortedByValue(
    totalsBy(
      scoped,
      (r) => r.key ?? '(unattributed)',
      (r) => r.amount,
    ),
  );
  return {
    type: 'table',
    title,
    columns: ['Name', 'Cost', 'Share of total'],
    rows: ranked.map(([key, amount]) => [
      labels.get(key) ?? key,
      formatMoney(amount, currencyOf(rows)),
      formatPercent(percent(amount, total)),
    ]),
  };
}

const insightSection = (insights: readonly Insight[]): Section => ({
  type: 'list',
  title: 'Insights',
  items: insights.length
    ? insights.map((i) => `${i.title} — ${i.detail}`)
    : ['No recommendations for this period.'],
});

const findingsSection = (report: ComplianceReport | null, title: string): Section => ({
  type: 'table',
  title,
  columns: ['Rule', 'Name', 'Severity', 'Status', 'Message'],
  rows: (report?.results ?? [])
    .filter((r) => r.status !== 'pass')
    .map((r) => [r.ruleId, r.ruleName, r.severity, r.status, r.message]),
});

// ─── Compliance ─────────────────────────────────────────────────────────────

export const complianceReportDefinition: ReportDefinition = {
  id: 'compliance',
  description: 'Latest compliance evaluation with every non-passing check',
  liveDatasets: [],
  period: (now) => ({ start: now, end: now }),
  build({ compliance, now }) {
    if (!compliance) throw new Error('No compliance report found: run `check` first');
    const s = compliance.summary;
    return {
      id: `compliance-${compliance.snapshotId}`,
      kind: 'compliance',
      title: `Compliance report — score ${formatScore(s)}`,
      generatedAt: now.toISOString(),
      period: null,
      sections: [
        {
          type: 'kpis',
          title: 'Summary',
          items: [
            { label: 'Score', value: formatScore(s) },
            { label: 'Failed', value: String(s.failed) },
            { label: 'Warnings', value: String(s.warnings) },
            { label: 'Skipped (missing data)', value: String(s.skipped) },
            { label: 'Errors', value: String(s.errors) },
            { label: 'Passed', value: String(s.passed) },
          ],
        },
        findingsSection(compliance, 'Findings'),
      ],
    };
  },
};

// ─── Weekly ─────────────────────────────────────────────────────────────────

const lastSevenDays = (now: Date): DateRange => ({
  start: startOfUtcDay(addDays(now, -7)),
  end: startOfUtcDay(now),
});

export const weeklyReportDefinition: ReportDefinition = {
  id: 'weekly',
  description: 'Seven-day digest: score trend, notable activity, cost and insights',
  liveDatasets: [],
  period: (now) => lastSevenDays(now),
  build({ now, period, snapshot, snapshots, compliance, complianceHistory, insights }) {
    const activities = uniqueBy(
      snapshots.flatMap((s) => s.data.activities ?? []),
      (a) => a.id,
    );
    const cost = dataOf(snapshot).cost.filter((r) => inPeriod(r.date, period));
    const total = sumBy(
      cost.filter((r) => r.dimension === 'total'),
      (r) => r.amount,
    );
    const first = complianceHistory.find((r) => r.generatedAt >= period.start.toISOString());
    const summary = compliance?.summary ?? null;
    const score = summary?.score ?? null;
    const change = score !== null && first ? score - first.summary.score : null;
    return {
      id: `weekly-${toIsoDate(period.end)}`,
      kind: 'weekly',
      title: `Weekly audit digest — ${toIsoDate(period.start)} to ${toIsoDate(addDays(period.end, -1))}`,
      generatedAt: now.toISOString(),
      period: { from: period.start.toISOString(), to: period.end.toISOString() },
      sections: [
        {
          type: 'kpis',
          title: 'Summary',
          items: [
            { label: 'Compliance score', value: summary === null ? 'n/a' : formatScore(summary) },
            {
              label: 'Score change',
              value: change === null ? 'n/a' : `${change >= 0 ? '+' : ''}${change}`,
            },
            { label: 'Activities collected', value: formatInteger(activities.length) },
            { label: 'Cost (7 days)', value: formatMoney(round(total), currencyOf(cost)) },
          ],
        },
        findingsSection(compliance, 'Open findings'),
        {
          type: 'table',
          title: 'Top activity types',
          columns: ['Activity type', 'Events'],
          rows: sortedByValue(countBy(activities, (a) => a.type)).slice(0, 15),
        },
        costBreakdown('Cost by product (7 days)', cost, 'product'),
        insightSection(insights),
      ],
    };
  },
};

// ─── Monthly ────────────────────────────────────────────────────────────────

function dailySection(data: DatasetMap, period: DateRange): Section {
  const cost = totalsBy(
    data.cost.filter((r) => r.dimension === 'total' && inPeriod(r.date, period)),
    (r) => r.date,
    (r) => r.amount,
  );
  const usage = data.usage.filter((r) => r.dimension === 'total' && inPeriod(r.date, period));
  const input = totalsBy(usage, (r) => r.date, inputTokens);
  const output = totalsBy(
    usage,
    (r) => r.date,
    (r) => r.outputTokens,
  );
  const days = [...new Set([...cost.keys(), ...input.keys()])].sort();
  return {
    type: 'table',
    title: 'Daily breakdown',
    columns: ['Date', 'Cost', 'Input tokens', 'Output tokens'],
    rows: days.map((d) => [d, round(cost.get(d) ?? 0), input.get(d) ?? 0, output.get(d) ?? 0]),
  };
}

const rawCostSection = (rows: readonly CostRow[]): Section => ({
  type: 'table',
  title: 'Raw cost records',
  columns: ['Date', 'Dimension', 'Key', 'Amount', 'List amount', 'Currency'],
  rows: rows.map((r) => [r.date, r.dimension, r.key, r.amount, r.listAmount, r.currency]),
});

export const monthlyReportDefinition: ReportDefinition = {
  id: 'monthly',
  description: 'Monthly cost and usage allocation by product, model and group, with raw records',
  liveDatasets: ['cost', 'usage', 'groups'],
  period: (now, month) => monthRange(month ?? previousMonth(now)),
  build({ now, period, snapshot, insights }) {
    const data = dataOf(snapshot);
    const cost = data.cost.filter((r) => inPeriod(r.date, period));
    const total = round(
      sumBy(
        cost.filter((r) => r.dimension === 'total'),
        (r) => r.amount,
      ),
    );
    const tokens = sumBy(
      data.usage.filter((r) => r.dimension === 'total' && inPeriod(r.date, period)),
      (r) => inputTokens(r) + r.outputTokens,
    );
    const days = Math.max(
      1,
      Math.round((period.end.getTime() - period.start.getTime()) / 86_400_000),
    );
    const groupNames = new Map(data.groups.map((g) => [g.id, g.name]));
    const currency = currencyOf(cost);
    return {
      id: `monthly-${monthKey(period.start)}`,
      kind: 'monthly',
      title: `Monthly cost report — ${monthKey(period.start)}`,
      generatedAt: now.toISOString(),
      period: { from: period.start.toISOString(), to: period.end.toISOString() },
      sections: [
        {
          type: 'kpis',
          title: 'Summary',
          items: [
            { label: 'Total cost', value: formatMoney(total, currency) },
            { label: 'Average daily cost', value: formatMoney(round(total / days), currency) },
            {
              label: 'Projected annual cost (x12)',
              value: formatMoney(round(total * 12), currency),
            },
            { label: 'Total tokens', value: formatInteger(tokens) },
          ],
        },
        costBreakdown('Cost by product', cost, 'product'),
        costBreakdown('Cost by model', cost, 'model'),
        costBreakdown('Cost by group', cost, 'group', groupNames),
        dailySection(data, period),
        insightSection(insights),
        {
          type: 'text',
          title: 'Notes',
          body:
            'Analytics cost data can be revised for up to 30 days; re-run this report later for invoicing-grade totals. ' +
            'Group rows attribute a member to every group they belonged to, so group shares can add up to more than 100%.',
        },
        rawCostSection(cost),
      ],
    };
  },
};

export const BUILTIN_REPORTS: readonly ReportDefinition[] = [
  complianceReportDefinition,
  weeklyReportDefinition,
  monthlyReportDefinition,
];
