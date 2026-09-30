import type { ModelUsage, UsageReport, Workspace, WorkspaceUsage } from '@claude-audit/shared';
import type { Bucket, CostResult, UsageQuery, UsageResult } from '../api/usage.js';

export interface UsageSource {
  listUsage(q: UsageQuery): Promise<Bucket<UsageResult>[]>;
  listCost(q: UsageQuery): Promise<Bucket<CostResult>[]>;
}

/** The API reports the default workspace as `workspace_id: null`. */
export const DEFAULT_WORKSPACE_ID = 'default';
const UNKNOWN_MODEL = 'unknown';

/** Month-to-date window in UTC: [first of the month 00:00Z, now]. */
export function monthToDate(now: Date = new Date()): UsageQuery {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { startingAt: start.toISOString(), endingAt: now.toISOString() };
}

/** Cost amounts are decimal strings in cents. */
export function centsToUsd(amount: string): number {
  const cents = Number(amount);
  return Number.isFinite(cents) ? cents / 100 : 0;
}

interface Totals {
  input: number;
  output: number;
  cost: number;
}

const empty = (): Totals => ({ input: 0, output: 0, cost: 0 });

function bucketOf(map: Map<string, Totals>, key: string): Totals {
  let t = map.get(key);
  if (!t) map.set(key, (t = empty()));
  return t;
}

/** Input tokens = uncached + cache reads + cache creation (5m and 1h). */
function inputTokens(r: UsageResult): number {
  return (
    r.uncached_input_tokens +
    r.cache_read_input_tokens +
    r.cache_creation.ephemeral_1h_input_tokens +
    r.cache_creation.ephemeral_5m_input_tokens
  );
}

export function buildUsageReport(
  usage: Bucket<UsageResult>[],
  cost: Bucket<CostResult>[],
  workspaces: Workspace[],
  period: UsageQuery,
): UsageReport {
  const byWorkspace = new Map<string, Totals>();
  const byModel = new Map<string, Totals>();
  const total = empty();

  for (const bucket of usage) {
    for (const r of bucket.results) {
      const input = inputTokens(r);
      for (const t of [
        total,
        bucketOf(byWorkspace, r.workspace_id ?? DEFAULT_WORKSPACE_ID),
        bucketOf(byModel, r.model ?? UNKNOWN_MODEL),
      ]) {
        t.input += input;
        t.output += r.output_tokens;
      }
    }
  }

  for (const bucket of cost) {
    for (const r of bucket.results) {
      if (r.currency !== 'USD') continue;
      const usd = centsToUsd(r.amount);
      total.cost += usd;
      bucketOf(byWorkspace, r.workspace_id ?? DEFAULT_WORKSPACE_ID).cost += usd;
      // Only token costs carry a model; other cost types are not attributed to a model.
      if (r.model) bucketOf(byModel, r.model).cost += usd;
    }
  }

  const names = new Map(workspaces.map((w) => [w.id, w.name]));
  const by_workspace: WorkspaceUsage[] = [...byWorkspace].map(([id, t]) => ({
    workspace_id: id,
    workspace_name: id === DEFAULT_WORKSPACE_ID ? 'Default' : (names.get(id) ?? id),
    input_tokens: t.input,
    output_tokens: t.output,
    cost_usd: t.cost,
  }));
  const by_model: ModelUsage[] = [...byModel].map(([model, t]) => ({
    model,
    input_tokens: t.input,
    output_tokens: t.output,
    cost_usd: t.cost,
  }));

  return {
    period_start: period.startingAt,
    period_end: period.endingAt,
    total_input_tokens: total.input,
    total_output_tokens: total.output,
    total_cost_usd: total.cost,
    by_workspace,
    by_model,
  };
}

/** Collects month-to-date usage and cost and aggregates them into a UsageReport. */
export async function collectUsage(
  source: UsageSource,
  workspaces: Workspace[],
  now: Date = new Date(),
): Promise<UsageReport> {
  const period = monthToDate(now);
  const [usage, cost] = await Promise.all([source.listUsage(period), source.listCost(period)]);
  return buildUsageReport(usage, cost, workspaces, period);
}
