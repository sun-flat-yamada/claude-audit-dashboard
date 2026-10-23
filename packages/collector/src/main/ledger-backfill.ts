import {
  addDays,
  backfillLedger,
  ledgerDatasetNames,
  ledgerSpecFor,
  monthKey,
  planBackfill,
  toIsoDate,
  type BackfillExclusion,
  type BackfillOutcome,
  type BackfillPlan,
  type LedgerBackfillResult,
} from '@claude-audit/core';
import { FsBackfillProgressStore } from '../adapters/storage/backfill-progress.js';
import { FsLedgerRepository, sha256Hex } from '../adapters/storage/ledger.js';
import { disabledDatasets } from '../infrastructure/config.js';
import type { Container } from './container.js';

export interface BackfillArgs {
  from: string;
  /** Default: the current month. */
  to?: string | undefined;
  /** Default: `defaultBackfillDatasets`. */
  datasets?: readonly string[] | undefined;
  force?: boolean | undefined;
}

const BUILTIN = ['activities', 'usage', 'cost', 'adoption', 'memberActivity'] as const;
const FEATURES = ['skillUsage', 'connectorUsage', 'pluginUsage', 'chatProjectUsage'] as const;

/**
 * The built-in time-bounded datasets, plus the optional per-day users and feature roll-ups when
 * their source is enabled; `sources.disabled` removes any of them.
 */
export function defaultBackfillDatasets(c: Container): string[] {
  const { memberActivityDaily, featureUsage } = c.config.sources;
  const disabled = new Set<string>(disabledDatasets(c.config));
  return [
    ...BUILTIN,
    ...(memberActivityDaily.enabled ? ['memberActivityDaily'] : []),
    ...(featureUsage.enabled ? FEATURES : []),
  ].filter((dataset) => !disabled.has(dataset));
}

/** `yyyy-mm-dd` of the last day of a half-open range that ends at midnight. */
const lastDay = (end: Date): string => toIsoDate(addDays(end, -1));

const EXCLUSION_REASON: Readonly<Record<BackfillExclusion['reason'], string>> = {
  epoch: 'before 2026-01-01 (the Analytics API has no data before it)',
  retention: 'older than the last 365 days usage_report / cost_report serve',
};

function reportPlan(c: Container, plan: BackfillPlan): void {
  const datasets = [...new Set(plan.units.map((u) => u.dataset))];
  c.logger.info(
    `Backfill ${plan.months[0] ?? ''}..${plan.months.at(-1) ?? ''}: ${String(plan.units.length)} unit(s) for ${datasets.join(', ') || 'no dataset'}`,
  );
  for (const { dataset, range, reason } of plan.excluded)
    c.logger.warn(
      `Backfill: ${dataset} ${toIsoDate(range.start)} .. ${lastDay(range.end)} excluded: ${EXCLUSION_REASON[reason]}`,
    );
  const state = ledgerDatasetNames().filter((name) => ledgerSpecFor(name)?.kind === 'state');
  c.logger.info(
    `Backfill: state datasets are not backfilled (the APIs keep no history of them; the ledger records them from the collections on): ${state.join(', ')}`,
  );
}

function reportUnit(c: Container, outcome: BackfillOutcome): void {
  const label = `Backfill ${outcome.unit.month} ${outcome.unit.dataset}`;
  if (outcome.status === 'fetched')
    c.logger.info(`${label}: ${String(outcome.count)} row(s) merged`);
  else if (outcome.status === 'skipped')
    c.logger.info(`${label}: already fetched after its revisions (use --force to fetch again)`);
  else c.logger.warn(`${label} ${outcome.status}: ${outcome.reason}`);
}

function reportResult(c: Container, result: LedgerBackfillResult): void {
  const count = (status: BackfillOutcome['status']) =>
    String(result.outcomes.filter((o) => o.status === status).length);
  c.logger.info(
    `Backfill: ${count('fetched')} fetched, ${count('skipped')} skipped, ${count('unavailable')} unavailable, ${count('failed')} failed; ${String(result.ledger.changed.length)} ledger file(s) changed`,
  );
  if (result.ledger.sealed.length > 0)
    c.logger.warn(`Backfill: sealed month(s) left unchanged: ${result.ledger.sealed.join(', ')}`);
  for (const [dataset, rows] of Object.entries(result.ledger.rejected))
    c.logger.warn(`Backfill: ${String(rows)} ${dataset} row(s) without a usable date were skipped`);
}

/** The plan of a request: the chosen datasets with the limits of their APIs. */
export function backfillPlanOf(c: Container, args: BackfillArgs, now: Date): BackfillPlan {
  const datasets = (args.datasets ?? defaultBackfillDatasets(c)).map((name) => {
    const definition = c.backfill.require(name);
    return { dataset: definition.dataset, limit: definition.limit };
  });
  return planBackfill({ from: args.from, to: args.to ?? monthKey(now), now, datasets });
}

/**
 * `ledger backfill`: fetches the requested months straight from the APIs (within what they still
 * serve) and merges them into the ledger. Expects the stored snapshots to be recorded first (the
 * caller runs `ledger update`), because the backfilled entries carry the backfill time.
 */
export async function ledgerBackfill(
  c: Container,
  args: BackfillArgs,
): Promise<LedgerBackfillResult> {
  const plan = backfillPlanOf(c, args, c.clock.now());
  reportPlan(c, plan);
  const result = await backfillLedger(plan, {
    source: (dataset) => c.backfill.get(dataset),
    repository: new FsLedgerRepository(c.store),
    hash: sha256Hex,
    progress: new FsBackfillProgressStore(c.store),
    clock: c.clock,
    force: args.force === true,
    onUnit: (outcome) => reportUnit(c, outcome),
  });
  reportResult(c, result);
  const failed = result.outcomes.filter((o) => o.status === 'failed');
  if (failed.length > 0)
    throw new Error(
      `Backfill: ${String(failed.length)} unit(s) failed (${failed.map((o) => `${o.unit.month} ${o.unit.dataset}`).join(', ')}); run it again to continue`,
    );
  return result;
}

const valueAfter = (args: readonly string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
};

const KNOWN_FLAGS = new Set(['--from', '--to', '--datasets', '--force']);

/** `backfill --from <yyyy-mm> [--to <yyyy-mm>] [--datasets a,b] [--force]` (after `backfill`). */
export function parseBackfillArgs(c: Container, args: readonly string[]): BackfillArgs {
  const unknown = args.filter((a) => a.startsWith('--') && !KNOWN_FLAGS.has(a));
  if (unknown.length > 0) throw new Error(`Unknown option(s): ${unknown.join(', ')}`);
  const from = valueAfter(args, '--from');
  if (!from) throw new Error('--from <yyyy-mm> is required');
  const list = valueAfter(args, '--datasets');
  const datasets = list?.split(',').map((d) => d.trim());
  for (const dataset of datasets ?? []) c.backfill.require(dataset);
  return { from, to: valueAfter(args, '--to'), datasets, force: args.includes('--force') };
}
