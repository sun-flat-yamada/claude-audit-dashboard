import type {
  DashboardActivity,
  DashboardAdoption,
  DashboardCheckResult,
  DashboardCoverage,
  DashboardKpi,
  DashboardShare,
  DashboardUsage,
  DashboardView,
} from '../../contracts/dashboard-view.js';
import { DASHBOARD_VIEW_SCHEMA_VERSION } from '../../contracts/dashboard-view.js';
import type { Insight } from '../../domain/analysis/analyzers.js';
import { assessedCount } from '../../domain/compliance/scoring.js';
import type { ComplianceReport } from '../../domain/compliance/types.js';
import { withDefaults, type DatasetMap, type DatasetName } from '../../domain/model/dataset.js';
import {
  ACTIVE_USER_PRODUCTS,
  type AdoptionDay,
  type CostRow,
  type UsageDimension,
  type UsageRow,
} from '../../domain/model/entities.js';
import { inputTokens } from '../../domain/model/metrics.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import { countBy, sortedByValue, sumBy, totalsBy } from '../../domain/util/collections.js';
import { maskEmails } from '../../domain/util/mask.js';
import { percent, round } from '../../domain/util/numbers.js';
import { monthKey } from '../../domain/util/time.js';
import { claudeCodeView } from './dashboard-claude-code.js';
import { productEngagement } from './dashboard-engagement.js';
import { buildModelMatrix, type UsageMatrixInput } from './usage-matrix-view.js';

export interface DashboardInput {
  now: Date;
  title: string;
  source: 'live' | 'demo';
  maskPii: boolean;
  snapshot: AuditSnapshot | null;
  report: ComplianceReport | null;
  /** Earlier compliance reports, oldest first. */
  history: readonly ComplianceReport[];
  insights: readonly Insight[];
  /**
   * The stored optional model x group collection (I/O stays with the caller). Omitted when the
   * collection is off; `null` means it is on but could not be read.
   */
  usageMatrix?: UsageMatrixInput | null | undefined;
}

type Mask = (text: string) => string;

const MAX_EVIDENCE = 20;
const MAX_NOTABLE = 30;

const collected = (snapshot: AuditSnapshot | null, name: DatasetName): boolean =>
  snapshot?.coverage[name]?.status === 'ok';

const latestAdoption = (data: DatasetMap) =>
  [...data.adoption].sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;

const kpi = (
  id: string,
  label: string,
  value: number | null,
  unit: DashboardKpi['unit'],
  hint: string | null = null,
): DashboardKpi => ({
  id,
  label,
  value,
  unit,
  hint,
});

/** Month-to-date total cost, or null when cost was not collected. */
function monthToDate(snapshot: AuditSnapshot | null, data: DatasetMap, now: Date): DashboardKpi {
  const month = monthKey(now);
  const rows = data.cost.filter((r) => r.dimension === 'total' && r.date.startsWith(month));
  const value = collected(snapshot, 'cost') ? round(sumBy(rows, (r) => r.amount)) : null;
  return kpi('mtd-cost', 'Month-to-date cost', value, 'currency', rows[0]?.currency ?? null);
}

/** Shown with the score whenever rules lacked the data (or failed) to produce a verdict. */
function coverageHint(report: ComplianceReport): string | null {
  const assessed = assessedCount(report.summary);
  return assessed === report.summary.total
    ? null
    : `${assessed} of ${report.summary.total} rules assessed`;
}

type KpiInput = Pick<DashboardInput, 'now' | 'snapshot' | 'report'>;

function kpis(input: KpiInput, data: DatasetMap): DashboardKpi[] {
  const { snapshot, report } = input;
  const adoptionDay = latestAdoption(data);
  const members = collected(snapshot, 'members')
    ? new Set(data.members.map((m) => m.id)).size
    : null;
  const open = report ? report.summary.failed + report.summary.warnings : null;
  return [
    kpi(
      'score',
      'Compliance score',
      report ? report.summary.score : null,
      'score',
      report ? coverageHint(report) : null,
    ),
    kpi('open-findings', 'Open findings', open, 'count'),
    kpi('members', 'Members', members, 'count'),
    kpi(
      'mau',
      'Monthly active users',
      adoptionDay ? adoptionDay.monthlyActiveUsers : null,
      'count',
    ),
    kpi(
      'seat-utilization',
      'Seat utilization (30d)',
      adoptionDay ? adoptionDay.monthlyAdoptionRate : null,
      'percent',
    ),
    monthToDate(snapshot, data, input.now),
  ];
}

/**
 * The KPI figures of the dashboard (score, open findings, members, MAU, seat utilization,
 * month-to-date cost) for one snapshot and report, as of `now`. Also what a time-point summary
 * records, so the dashboard and the summary cannot disagree.
 */
export const buildDashboardKpis = (input: KpiInput): DashboardKpi[] =>
  kpis(input, withDefaults(input.snapshot?.data ?? {}));

const resultView =
  (mask: Mask) =>
  (r: ComplianceReport['results'][number]): DashboardCheckResult => ({
    ruleId: r.ruleId,
    ruleName: r.ruleName,
    category: r.category,
    severity: r.severity,
    status: r.status,
    message: mask(r.message),
    remediation: r.remediation,
    evidence: r.evidence
      .slice(0, MAX_EVIDENCE)
      .map((e) => ({ kind: e.kind, label: mask(e.label) })),
  });

const EMPTY_SUMMARY = { score: 0, passed: 0, failed: 0, warnings: 0, skipped: 0, errors: 0 };

function compliance(input: DashboardInput, mask: Mask): DashboardView['compliance'] {
  const { report, history } = input;
  const reports = report ? [...history.filter((h) => h.id !== report.id), report] : [...history];
  const { score, passed, failed, warnings, skipped, errors } = report
    ? report.summary
    : EMPTY_SUMMARY;
  const byCategory = Object.entries(report ? report.summary.byCategory : {})
    .filter(([, v]) => v.total > 0)
    .map(([category, v]) => ({ category, ...v }));
  return {
    score,
    passed,
    failed,
    warnings,
    skipped,
    errors,
    byCategory,
    history: reports.map((r) => ({ date: r.generatedAt, score: r.summary.score })),
    results: (report ? report.results : []).map(resultView(mask)),
  };
}

const coverage = (snapshot: AuditSnapshot | null): DashboardCoverage[] =>
  Object.entries(snapshot?.coverage ?? {}).map(([dataset, meta]) => ({
    dataset,
    status: meta.status,
    source: meta.source ?? null,
    reason: meta.reason ?? null,
    count: meta.count ?? null,
    asOf: meta.asOf ?? null,
  }));

function shares(
  rows: readonly CostRow[],
  dimension: UsageDimension,
  labels: ReadonlyMap<string, string>,
): DashboardShare[] {
  const total = sumBy(
    rows.filter((r) => r.dimension === 'total'),
    (r) => r.amount,
  );
  const scoped = rows.filter((r) => r.dimension === dimension);
  return sortedByValue(
    totalsBy(
      scoped,
      (r) => r.key ?? '(unattributed)',
      (r) => r.amount,
    ),
  ).map(([key, value]) => ({
    key,
    label: labels.get(key) ?? key,
    value: round(value),
    percent: percent(value, total),
  }));
}

const TOKEN_FIELDS = [
  'uncachedInputTokens',
  'cacheReadInputTokens',
  'cacheCreationInputTokens',
  'outputTokens',
] as const;

type TokenField = (typeof TOKEN_FIELDS)[number];

const tokensByDate = (rows: readonly UsageRow[], field: TokenField) =>
  totalsBy(
    rows,
    (r) => r.date,
    (r) => r[field],
  );

function dailySeries(data: DatasetMap): DashboardUsage['daily'] {
  const cost = totalsBy(
    data.cost.filter((r) => r.dimension === 'total'),
    (r) => r.date,
    (r) => r.amount,
  );
  const totals = data.usage.filter((r) => r.dimension === 'total');
  const input = totalsBy(totals, (r) => r.date, inputTokens);
  const tokens = Object.fromEntries(
    TOKEN_FIELDS.map((field) => [field, tokensByDate(totals, field)]),
  ) as Record<TokenField, Map<string, number>>;
  return [...new Set([...cost.keys(), ...input.keys()])].sort().map((date) => ({
    date,
    cost: round(cost.get(date) ?? 0),
    inputTokens: input.get(date) ?? 0,
    outputTokens: tokens.outputTokens.get(date) ?? 0,
    uncachedInputTokens: tokens.uncachedInputTokens.get(date) ?? 0,
    cacheReadInputTokens: tokens.cacheReadInputTokens.get(date) ?? 0,
    cacheCreationInputTokens: tokens.cacheCreationInputTokens.get(date) ?? 0,
  }));
}

/**
 * Cache reads as a percent of all input tokens (the `cache-efficiency` analyzer's definition),
 * null when no input was recorded.
 */
function cacheHitRate(data: DatasetMap): number | null {
  const totals = data.usage.filter((r) => r.dimension === 'total');
  const input = sumBy(totals, inputTokens);
  return input === 0
    ? null
    : percent(
        sumBy(totals, (r) => r.cacheReadInputTokens),
        input,
      );
}

function usage(snapshot: AuditSnapshot | null, data: DatasetMap): DashboardUsage | null {
  if (!snapshot || (!collected(snapshot, 'cost') && !collected(snapshot, 'usage'))) return null;
  const groupNames = new Map(data.groups.map((g) => [g.id, g.name]));
  return {
    currency: data.cost[0]?.currency ?? 'USD',
    asOf: snapshot.coverage.cost?.asOf ?? snapshot.coverage.usage?.asOf ?? null,
    daily: dailySeries(data),
    cacheHitRate: cacheHitRate(data),
    byProduct: shares(data.cost, 'product', new Map()),
    byModel: shares(data.cost, 'model', new Map()),
    byGroup: shares(data.cost, 'group', groupNames),
  };
}

const PRODUCT_ORDER = new Map<string, number>(ACTIVE_USER_PRODUCTS.map((p, i) => [p.product, i]));
const PRODUCT_LABEL = new Map<string, string>(
  ACTIVE_USER_PRODUCTS.map((p) => [p.product, p.label]),
);

/**
 * Per-product active users: the latest day that has a breakdown (weekly active descending, then
 * catalog order) and the weekly trend. Empty object when no day has one, so the fields are absent.
 */
function productAdoption(
  days: readonly AdoptionDay[],
): Pick<DashboardAdoption, 'byProduct' | 'productWeekly'> {
  const withProducts = days.filter((d) => (d.byProduct?.length ?? 0) > 0);
  const latest = withProducts.at(-1)?.byProduct;
  if (!latest) return {};
  const order = (product: string) => PRODUCT_ORDER.get(product) ?? PRODUCT_ORDER.size;
  return {
    byProduct: [...latest]
      .sort((a, b) => b.wau - a.wau || order(a.product) - order(b.product))
      .map((p) => ({ ...p, label: PRODUCT_LABEL.get(p.product) ?? p.product })),
    productWeekly: withProducts.map((d) => ({
      date: d.date,
      wau: Object.fromEntries((d.byProduct ?? []).map((p) => [p.product, p.wau])),
    })),
  };
}

function adoption(snapshot: AuditSnapshot | null, data: DatasetMap): DashboardAdoption | null {
  if (!collected(snapshot, 'adoption')) return null;
  const days = [...data.adoption].sort((a, b) => a.date.localeCompare(b.date));
  const latest = days.at(-1);
  return {
    daily: days.map((d) => ({
      date: d.date,
      dau: d.dailyActiveUsers,
      wau: d.weeklyActiveUsers,
      mau: d.monthlyActiveUsers,
    })),
    assignedSeats: latest?.assignedSeats ?? null,
    monthlyAdoptionRate: latest?.monthlyAdoptionRate ?? null,
    pendingInvites: latest?.pendingInvites ?? null,
    ...productAdoption(days),
  };
}

function activity(input: DashboardInput, data: DatasetMap, mask: Mask): DashboardActivity | null {
  const { snapshot, report } = input;
  if (!collected(snapshot, 'activities')) return null;
  const byId = new Map(data.activities.map((a) => [a.id, a]));
  const notable = (report?.results ?? [])
    .filter((r) => r.category === 'activity-monitoring' && r.status === 'warning')
    .flatMap((r) =>
      r.evidence.flatMap((e) => {
        const a = byId.get(e.id);
        return a
          ? [
              {
                id: a.id,
                ruleId: r.ruleId,
                type: a.type,
                createdAt: a.createdAt,
                actor: mask(a.actor.email ?? a.actor.id ?? a.actor.kind),
              },
            ]
          : [];
      }),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_NOTABLE);
  return {
    total: data.activities.length,
    window: snapshot?.coverage.activities?.window ?? null,
    topTypes: sortedByValue(countBy(data.activities, (a) => a.type))
      .slice(0, 10)
      .map(([type, count]) => ({ type, count })),
    notable,
  };
}

/** Product engagement from the member-activity rows; absent without data (older views lack it). */
function engagement(snapshot: AuditSnapshot | null, data: DatasetMap) {
  if (!collected(snapshot, 'memberActivity')) return {};
  const window = snapshot?.coverage.memberActivity?.window ?? null;
  const view = productEngagement(data.memberActivity, window);
  return view ? { engagement: view } : {};
}

/** Claude Code aggregate (AN-4); absent unless the optional dataset was collected. */
function claudeCode(snapshot: AuditSnapshot | null, data: DatasetMap) {
  if (!collected(snapshot, 'claudeCodeActivity')) return {};
  const window = snapshot?.coverage.claudeCodeActivity?.window ?? null;
  return { claudeCode: claudeCodeView(data.claudeCodeActivity, window) };
}

/** Builds the published dashboard contract: aggregates only, PII masked when requested. */
export function buildDashboardView(input: DashboardInput): DashboardView {
  const mask: Mask = input.maskPii ? maskEmails : (text) => text;
  const data = withDefaults(input.snapshot?.data ?? {});
  return {
    schemaVersion: DASHBOARD_VIEW_SCHEMA_VERSION,
    generatedAt: input.now.toISOString(),
    collectedAt: input.snapshot?.collectedAt ?? null,
    source: input.source,
    title: input.title,
    organizations: data.organizations.map((o) => ({ id: o.id, name: o.name })),
    kpis: kpis(input, data),
    compliance: compliance(input, mask),
    coverage: coverage(input.snapshot),
    usage: usage(input.snapshot, data),
    adoption: adoption(input.snapshot, data),
    activity: activity(input, data, mask),
    ...engagement(input.snapshot, data),
    ...claudeCode(input.snapshot, data),
    insights: input.insights.map(({ id, kind, priority, title, detail }) => ({
      id,
      kind,
      priority,
      title,
      detail,
    })),
    modelMatrix: buildModelMatrix(
      input.usageMatrix,
      new Map(data.groups.map((g) => [g.id, g.name])),
    ),
  };
}
