import { z } from 'zod';
import { DETAIL_DIR } from './detail-view.js';

/**
 * Public monthly cost report data (F-009): a small mapped subset of the collector's monthly
 * report, not the report document itself. Files live under `detail/monthly/` and are published
 * with the other detail files only under the detail publication condition (cost is confidential).
 * They carry no per-person data. Bump `MONTHLY_REPORT_SCHEMA_VERSION` on breaking changes.
 */
export const MONTHLY_REPORT_SCHEMA_VERSION = 1 as const;

export const MONTHLY_DIR = `${DETAIL_DIR}/monthly`;
export const MONTHLY_INDEX_PATH = `${MONTHLY_DIR}/index.json`;
export const monthlyReportPath = (id: string): string => `${MONTHLY_DIR}/${id}.json`;

const version = z.literal(MONTHLY_REPORT_SCHEMA_VERSION);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const status = z.enum(['ok', 'unavailable']);

/** One cost row. `share` is the percentage of the organization total (groups overlap). */
export const monthlyCostRowSchema = z.object({
  key: z.string(),
  name: z.string(),
  amount: z.number(),
  share: z.number(),
});

export const monthlyReportSchema = z.object({
  schemaVersion: version,
  generatedAt: z.string(),
  /** `monthly-yyyy-mm`, also the file name. */
  id: z.string().regex(/^monthly-\d{4}-(0[1-9]|1[0-2])$/),
  month,
  period: z.object({ from: z.string(), to: z.string() }).nullable(),
  /** `unavailable` when the month has no cost records (dataset not collected / empty). */
  status,
  reason: z.string().nullable(),
  currency: z.string(),
  /** Organization total from the ungrouped value; group rows overlap and never add up to it. */
  totalCost: z.number().nullable(),
  byGroup: z.array(monthlyCostRowSchema),
  byModel: z.array(monthlyCostRowSchema),
  byProduct: z.array(monthlyCostRowSchema),
  notes: z.array(z.string()),
});

export const monthlyReportIndexSchema = z.object({
  schemaVersion: version,
  generatedAt: z.string(),
  /** Newest month first. */
  reports: z.array(
    z.object({
      id: z.string(),
      month,
      path: z.string(),
      status,
      currency: z.string(),
      totalCost: z.number().nullable(),
      generatedAt: z.string(),
    }),
  ),
});

export type MonthlyCostRow = z.infer<typeof monthlyCostRowSchema>;
export type MonthlyReport = z.infer<typeof monthlyReportSchema>;
export type MonthlyReportIndex = z.infer<typeof monthlyReportIndexSchema>;
export type MonthlyReportIndexEntry = MonthlyReportIndex['reports'][number];
