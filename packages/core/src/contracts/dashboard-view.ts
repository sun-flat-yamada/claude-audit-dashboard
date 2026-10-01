import { z } from 'zod';

/**
 * Published contract between the collector (writer of `dashboard.json`) and the dashboard UI.
 * Aggregates only; e-mail addresses are masked unless masking is disabled in config.
 * Bump `schemaVersion` on breaking changes.
 */
export const DASHBOARD_VIEW_SCHEMA_VERSION = 2;

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
      inputTokens: z.number(),
      outputTokens: z.number(),
    }),
  ),
  byProduct: z.array(share),
  byModel: z.array(share),
  byGroup: z.array(share),
});

const adoption = z.object({
  daily: z.array(z.object({ date: z.string(), dau: z.number(), wau: z.number(), mau: z.number() })),
  assignedSeats: z.number().nullable(),
  monthlyAdoptionRate: z.number().nullable(),
  pendingInvites: z.number().nullable(),
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
