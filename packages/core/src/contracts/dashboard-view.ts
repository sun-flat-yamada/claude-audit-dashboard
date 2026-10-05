import { z } from 'zod';

/**
 * Published contract between the collector (writer of `dashboard.json`) and the dashboard UI.
 * Aggregates only; e-mail addresses are masked unless masking is disabled in config.
 * Bump `schemaVersion` on breaking changes.
 */
export const DASHBOARD_VIEW_SCHEMA_VERSION = 3;

/** Key used when the API reports a row without a model / without an RBAC group. */
export const MATRIX_UNKNOWN_MODEL = '(unknown)';
export const MATRIX_NO_GROUP = '(none)';

/** Most models / groups kept in the matrix (highest cost first); the rest are only counted. */
export const MATRIX_MODEL_LIMIT = 12;
export const MATRIX_GROUP_LIMIT = 30;

const matrixMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const matrixCost = z.number().nonnegative();

/**
 * Model x RBAC group spend (F-010, optional: `sources.usageMatrix.enabled`). Aggregates only:
 * group names (already published in `usage.byGroup`) and cost, no per-person data. Group cells
 * overlap (a member counts in every group they belong to), so they must never be added up: model
 * totals and the monthly mix are the ungrouped values.
 */
const matrixData = z.object({
  status: z.literal('ok'),
  /** Freshness watermark of the cost report (`data_refreshed_at`), when reported. */
  asOf: z.string().nullable(),
  window: z.object({ from: z.string(), to: z.string() }),
  currency: z.string(),
  /** Ascending. */
  months: z.array(matrixMonth),
  /** Highest total first; `total` is the ungrouped cost over the whole window. */
  models: z.array(z.object({ key: z.string(), name: z.string(), total: matrixCost })),
  /** Highest group spend first. */
  groups: z.array(z.object({ key: z.string(), name: z.string() })),
  omittedModels: z.number().int().nonnegative(),
  omittedGroups: z.number().int().nonnegative(),
  /** Overlapping: one row per month x model x group that had spend. */
  cells: z.array(
    z.object({ month: matrixMonth, model: z.string(), group: z.string(), cost: matrixCost }),
  ),
  /** Ungrouped cost per month x model (additive). */
  mix: z.array(z.object({ month: matrixMonth, model: z.string(), cost: matrixCost })),
  /** Ungrouped cost per month over all models, including the omitted ones. */
  monthTotals: z.array(z.object({ month: matrixMonth, cost: matrixCost })),
});

/** Every cell / mix row refers to a listed model, group and month; the lists have no repeats. */
function matrixIssues(m: z.infer<typeof matrixData>): string[] {
  const models = new Set(m.models.map((x) => x.key));
  const groups = new Set(m.groups.map((x) => x.key));
  const months = new Set(m.months);
  const stray =
    m.cells.filter((c) => !models.has(c.model) || !groups.has(c.group) || !months.has(c.month))
      .length + m.mix.filter((r) => !models.has(r.model) || !months.has(r.month)).length;
  return [
    ...(stray === 0 ? [] : ['cells or mix rows refer to an unlisted model, group or month']),
    ...(models.size === m.models.length && groups.size === m.groups.length
      ? []
      : ['duplicate model or group keys']),
  ];
}

const modelMatrix = z
  .discriminatedUnion('status', [
    matrixData,
    z.object({ status: z.enum(['unavailable', 'error']), reason: z.string() }),
  ])
  .superRefine((value, ctx) => {
    if (value.status !== 'ok') return;
    for (const message of matrixIssues(value)) ctx.addIssue({ code: 'custom', message });
  });

const share = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  percent: z.number(),
});

const kpi = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number().nullable(),
  unit: z.enum(['score', 'count', 'currency', 'percent']),
  hint: z.string().nullable(),
});

const checkResult = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  category: z.string(),
  severity: z.string(),
  status: z.string(),
  message: z.string(),
  remediation: z.string().nullable(),
  evidence: z.array(z.object({ kind: z.string(), label: z.string() })),
});

const coverageEntry = z.object({
  dataset: z.string(),
  status: z.string(),
  source: z.string().nullable(),
  reason: z.string().nullable(),
  count: z.number().nullable(),
  asOf: z.string().nullable(),
});

const usage = z.object({
  currency: z.string(),
  asOf: z.string().nullable(),
  daily: z.array(
    z.object({
      date: z.string(),
      cost: z.number(),
      /** All input tokens: uncached + cache reads + cache writes. */
      inputTokens: z.number(),
      outputTokens: z.number(),
      /** Input breakdown; optional so a `dashboard.json` written before it still parses. */
      uncachedInputTokens: z.number().optional(),
      cacheReadInputTokens: z.number().optional(),
      cacheCreationInputTokens: z.number().optional(),
    }),
  ),
  /**
   * Cache reads as a percent of all input tokens over the collected period (one decimal),
   * null when there was no input; absent in a `dashboard.json` written before it existed.
   */
  cacheHitRate: z.number().nullable().optional(),
  byProduct: z.array(share),
  byModel: z.array(share),
  byGroup: z.array(share),
});

const adoption = z.object({
  daily: z.array(z.object({ date: z.string(), dau: z.number(), wau: z.number(), mau: z.number() })),
  assignedSeats: z.number().nullable(),
  monthlyAdoptionRate: z.number().nullable(),
  pendingInvites: z.number().nullable(),
  /**
   * Active users per product on the latest day, weekly active descending; absent when the API
   * returned no per-product counts or in a `dashboard.json` written before it existed.
   */
  byProduct: z
    .array(
      z.object({
        product: z.string(),
        label: z.string(),
        dau: z.number(),
        wau: z.number(),
        mau: z.number(),
      }),
    )
    .optional(),
  /** Weekly active users per product and day (keyed by `byProduct[].product`); same rules. */
  productWeekly: z
    .array(z.object({ date: z.string(), wau: z.record(z.string(), z.number()) }))
    .optional(),
});

const activity = z.object({
  total: z.number(),
  window: z.object({ from: z.string(), to: z.string() }).nullable(),
  topTypes: z.array(z.object({ type: z.string(), count: z.number() })),
  notable: z.array(
    z.object({
      id: z.string(),
      ruleId: z.string(),
      type: z.string(),
      createdAt: z.string(),
      actor: z.string(),
    }),
  ),
});

const insight = z.object({
  id: z.string(),
  kind: z.string(),
  priority: z.string(),
  title: z.string(),
  detail: z.string(),
});

export const dashboardViewSchema = z.object({
  schemaVersion: z.literal(DASHBOARD_VIEW_SCHEMA_VERSION),
  generatedAt: z.string(),
  collectedAt: z.string().nullable(),
  source: z.enum(['live', 'demo']),
  title: z.string(),
  organizations: z.array(z.object({ id: z.string(), name: z.string() })),
  kpis: z.array(kpi),
  compliance: z.object({
    score: z.number(),
    passed: z.number(),
    failed: z.number(),
    warnings: z.number(),
    skipped: z.number(),
    errors: z.number(),
    byCategory: z.array(z.object({ category: z.string(), total: z.number(), failed: z.number() })),
    history: z.array(z.object({ date: z.string(), score: z.number() })),
    results: z.array(checkResult),
  }),
  coverage: z.array(coverageEntry),
  usage: usage.nullable(),
  adoption: adoption.nullable(),
  activity: activity.nullable(),
  insights: z.array(insight),
  /** null when the optional collection is off (`sources.usageMatrix.enabled`). */
  modelMatrix: modelMatrix.nullable(),
});

export type DashboardView = z.infer<typeof dashboardViewSchema>;
export type DashboardKpi = z.infer<typeof kpi>;
export type DashboardShare = z.infer<typeof share>;
export type DashboardCheckResult = z.infer<typeof checkResult>;
export type DashboardCoverage = z.infer<typeof coverageEntry>;
export type DashboardUsage = z.infer<typeof usage>;
export type DashboardAdoption = z.infer<typeof adoption>;
export type DashboardActivity = z.infer<typeof activity>;
export type DashboardInsight = z.infer<typeof insight>;
export type DashboardModelMatrix = z.infer<typeof modelMatrix>;
export type DashboardModelMatrixData = z.infer<typeof matrixData>;
