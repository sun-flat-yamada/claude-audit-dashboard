import { z } from 'zod';
import { SNAPSHOT_ID } from './archive-view.js';
import { DETAIL_DIR } from './detail-view.js';

/**
 * Per-time-point summary (F-015): what is needed to compare two collections without the raw
 * snapshot: the score with the number of assessed rules, one status per rule, one status per
 * dataset and the KPI figures. Statuses and counts only: no evidence, no labels, no per-person
 * data, so nothing here identifies a person and no masking is needed. The schemas are strict:
 * a file carrying any other field (evidence, messages) does not match the contract.
 *
 * Two homes share the contract:
 * - the persistent store `summaries/<snapshot id>.json` on `data/audit` (written next to each
 *   judged snapshot, so a point outlives the archiving of its snapshot), and
 * - the published copy `detail/compare/<snapshot id>.json` plus the selectable-point index
 *   `detail/compare/index.json` (listed in the detail manifest as `kind: compare`; published
 *   only under the detail publication condition, results and cost are confidential).
 *
 * Bump `TIME_POINT_SUMMARY_SCHEMA_VERSION` / `COMPARE_SCHEMA_VERSION` on breaking changes.
 */
export const TIME_POINT_SUMMARY_SCHEMA_VERSION = 1 as const;
export const COMPARE_SCHEMA_VERSION = 1 as const;

/** Newest points offered for comparison (also the report-history limit of the collector). */
export const COMPARE_POINT_LIMIT = 90;

export const SUMMARY_STORE_DIR = 'summaries';
export const summaryStorePath = (id: string): string => `${SUMMARY_STORE_DIR}/${id}.json`;

export const COMPARE_DIR = `${DETAIL_DIR}/compare`;
export const COMPARE_INDEX_PATH = `${COMPARE_DIR}/index.json`;
export const comparePointPath = (id: string): string => `${COMPARE_DIR}/${id}.json`;

/** Point ids are snapshot ids (`yyyy-mm-ddThh-mm-ssZ`) and the file names. */
const pointId = z.string().regex(SNAPSHOT_ID);

export const RULE_STATUSES = ['pass', 'warning', 'fail', 'skipped', 'error'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];
export const DATASET_STATUSES = ['ok', 'unavailable', 'error'] as const;
export type DatasetStatusValue = (typeof DATASET_STATUSES)[number];

export const timePointSummarySchema = z.strictObject({
  schemaVersion: z.literal(TIME_POINT_SUMMARY_SCHEMA_VERSION),
  /** Snapshot id of the point. */
  id: pointId,
  collectedAt: z.string(),
  score: z.number(),
  /** Rules that produced a verdict (not skipped, not errored). */
  assessed: z.number().int().nonnegative(),
  /** Rules judged at the point (`rules.length`). */
  total: z.number().int().nonnegative(),
  rules: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      severity: z.string(),
      status: z.enum(RULE_STATUSES),
    }),
  ),
  /** Rule ids that were switched off at the point (configuration), sorted. */
  disabledRules: z.array(z.string()),
  /** Sorted by dataset name. */
  datasets: z.array(
    z.strictObject({
      name: z.string(),
      status: z.enum(DATASET_STATUSES),
      count: z.number().nullable(),
    }),
  ),
  kpis: z.array(
    z.strictObject({
      id: z.string(),
      label: z.string(),
      unit: z.enum(['score', 'count', 'currency', 'percent']),
      value: z.number().nullable(),
    }),
  ),
});

export const compareIndexSchema = z.strictObject({
  schemaVersion: z.literal(COMPARE_SCHEMA_VERSION),
  generatedAt: z.string(),
  /**
   * Selectable points, newest first. `summary`: `detail/compare/<id>.json` exists;
   * `archived`: only the snapshot id is known (its summary was never written), score unknown.
   */
  points: z.array(
    z.strictObject({
      id: pointId,
      collectedAt: z.string().nullable(),
      state: z.enum(['summary', 'archived']),
      score: z.number().nullable(),
      assessed: z.number().int().nonnegative().nullable(),
    }),
  ),
});

export type TimePointSummary = z.infer<typeof timePointSummarySchema>;
export type TimePointRule = TimePointSummary['rules'][number];
export type TimePointDataset = TimePointSummary['datasets'][number];
export type TimePointKpi = TimePointSummary['kpis'][number];
export type CompareIndex = z.infer<typeof compareIndexSchema>;
export type ComparePoint = CompareIndex['points'][number];
