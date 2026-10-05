import { z } from 'zod';
import { DETAIL_DIR } from './detail-view.js';

/**
 * Model x RBAC group spend (F-010): month x model x group cost cells plus the ungrouped model
 * mix per month. Listed in the detail manifest (`kind: usage-matrix`) and published under the
 * detail publication condition (cost is confidential). Carries group names (organization
 * structure) but no per-person data. Group cells overlap (a member counts in every group they
 * belong to), so they must never be added up: totals come from the ungrouped `mix` values.
 * Bump `USAGE_MATRIX_SCHEMA_VERSION` on breaking changes.
 */
export const USAGE_MATRIX_SCHEMA_VERSION = 1 as const;

export const DETAIL_USAGE_MATRIX_PATH = `${DETAIL_DIR}/usage-matrix.json`;

/** Key used when the API reports a row without a model / without an RBAC group. */
export const MATRIX_UNKNOWN_MODEL = '(unknown)';
export const MATRIX_NO_GROUP = '(none)';

/** Most models / groups kept in a file (highest cost first); the rest are only counted. */
export const MATRIX_MODEL_LIMIT = 12;
export const MATRIX_GROUP_LIMIT = 30;

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const cost = z.number().nonnegative();

const modelRow = z.object({
  key: z.string(),
  name: z.string(),
  /** Ungrouped cost over the whole window (never the sum of group cells). */
  total: cost,
});

const groupRow = z.object({ key: z.string(), name: z.string() });

export const detailUsageMatrixSchema = z.object({
  schemaVersion: z.literal(USAGE_MATRIX_SCHEMA_VERSION),
  generatedAt: z.string(),
  /** Freshness watermark of the cost report (`data_refreshed_at`), when reported. */
  asOf: z.string().nullable(),
  window: z.object({ from: z.string(), to: z.string() }),
  currency: z.string(),
  /** Ascending. */
  months: z.array(month),
  /** Highest total first. */
  models: z.array(modelRow),
  /** Highest group spend first. */
  groups: z.array(groupRow),
  omittedModels: z.number().int().nonnegative(),
  omittedGroups: z.number().int().nonnegative(),
  /** Overlapping: one row per month x model x group that had spend. */
  cells: z.array(z.object({ month, model: z.string(), group: z.string(), cost })),
  /** Ungrouped cost per month x model (additive). */
  mix: z.array(z.object({ month, model: z.string(), cost })),
  /** Ungrouped cost per month over all models, including the omitted ones. */
  monthTotals: z.array(z.object({ month, cost })),
});

export type DetailUsageMatrix = z.infer<typeof detailUsageMatrixSchema>;
export type UsageMatrixCell = DetailUsageMatrix['cells'][number];
export type UsageMatrixMixRow = DetailUsageMatrix['mix'][number];
