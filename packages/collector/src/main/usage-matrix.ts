import {
  aggregateMatrixRows,
  addDays,
  startOfUtcDay,
  type DateRange,
  type MatrixCostRow,
  type UsageMatrixInput,
  type CollectResult,
} from '@claude-audit/core';
import { z } from 'zod';
import { ApiError } from '../adapters/anthropic/http-client.js';
import { stableStringify } from '../adapters/storage/file-store.js';
import type { Container } from './container.js';

/** Where the optional model x group collection is stored between `usage-matrix` and `detail`. */
export const USAGE_MATRIX_INPUT_PATH = 'usage-matrix/input.json';
export const USAGE_MATRIX_INPUT_VERSION = 1 as const;

/** The gateway side of the optional collection (null in the container when it is off). */
export interface MatrixSource {
  costMatrix(
    range: DateRange,
    now: Date,
  ): Promise<CollectResult<{ pairs: MatrixCostRow[]; byModel: MatrixCostRow[] }>>;
}

const key = z.string().nullable();
const inputSchema = z.discriminatedUnion('status', [
  z.object({
    schemaVersion: z.literal(USAGE_MATRIX_INPUT_VERSION),
    status: z.literal('ok'),
    asOf: z.string().nullable(),
    window: z.object({ from: z.string(), to: z.string() }),
    data: z.object({
      currency: z.string(),
      cells: z.array(
        z.object({ month: z.string(), model: key, group: key, cost: z.number().nonnegative() }),
      ),
      mix: z.array(z.object({ month: z.string(), model: key, cost: z.number().nonnegative() })),
    }),
  }),
  z.object({
    schemaVersion: z.literal(USAGE_MATRIX_INPUT_VERSION),
    status: z.enum(['unavailable', 'error']),
    reason: z.string(),
  }),
]);

/** HTTP statuses that mean "not collectable with this key, plan or parameter combination". */
const UNAVAILABLE_STATUS = new Set([400, 401, 403, 404, 422]);

const clip = (text: string): string => (text.length > 160 ? `${text.slice(0, 157)}...` : text);

/** A failure as a stored status and a short reason (no response body, no key material). */
function degrade(error: unknown): { status: 'unavailable' | 'error'; reason: string } {
  if (error instanceof ApiError && UNAVAILABLE_STATUS.has(error.status))
    return {
      status: 'unavailable',
      reason: `the cost report rejected the model x group request (HTTP ${String(error.status)})`,
    };
  const what = error instanceof ApiError ? `HTTP ${String(error.status)}` : 'unexpected failure';
  return { status: 'error', reason: clip(`the model x group collection failed (${what})`) };
}

async function collectInput(c: Container): Promise<z.output<typeof inputSchema>> {
  const base = { schemaVersion: USAGE_MATRIX_INPUT_VERSION } as const;
  if (!c.matrix)
    return {
      ...base,
      status: 'unavailable',
      reason:
        'no Analytics API key (set ANTHROPIC_ENTERPRISE_API_KEY or ANTHROPIC_ANALYTICS_API_KEY)',
    };
  const now = c.clock.now();
  const range = {
    start: addDays(startOfUtcDay(now), -c.config.sources.usageMatrix.lookbackDays),
    end: now,
  };
  try {
    const result = await c.matrix.costMatrix(range, now);
    return {
      ...base,
      status: 'ok',
      asOf: result.asOf ?? null,
      window: result.window ?? { from: range.start.toISOString(), to: range.end.toISOString() },
      data: aggregateMatrixRows(result.items.pairs, result.items.byModel),
    };
  } catch (error) {
    return { ...base, ...degrade(error) };
  }
}

/**
 * Optional F-010 collection. Does nothing unless `sources.usageMatrix.enabled`; a failure is
 * stored as `unavailable` / `error` with a short reason and never stops the pipeline. Returns the
 * stored status, or null when the collection is off.
 */
export async function collectUsageMatrix(
  c: Container,
): Promise<z.output<typeof inputSchema>['status'] | null> {
  if (!c.config.sources.usageMatrix.enabled) return null;
  const input = await collectInput(c);
  await c.artifacts.write(USAGE_MATRIX_INPUT_PATH, stableStringify(inputSchema.parse(input)));
  return input.status;
}

/**
 * Reads the stored input tolerantly: `undefined` when the collection is off (no manifest entry),
 * `null` when it is on but nothing readable is stored yet.
 */
export async function readUsageMatrixInput(
  c: Container,
): Promise<UsageMatrixInput | null | undefined> {
  if (!c.config.sources.usageMatrix.enabled) return undefined;
  const parsed = inputSchema.safeParse(await c.store.readJson(USAGE_MATRIX_INPUT_PATH));
  if (!parsed.success) return null;
  const stored = parsed.data;
  return stored.status === 'ok'
    ? { status: 'ok', asOf: stored.asOf, window: stored.window, data: stored.data }
    : { status: stored.status, reason: stored.reason };
}
