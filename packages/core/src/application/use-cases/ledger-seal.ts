import type { BackfillPlan, BackfillUnit } from '../../domain/ledger/backfill.js';
import type { LedgerEntry, LedgerHasher } from '../../domain/ledger/entry.js';
import type { SealOutcome } from '../../domain/ledger/health.js';
import { ledgerEntriesOf, mergeLedgerEntries } from '../../domain/ledger/ledger.js';
import type {
  LedgerManifest,
  LedgerSealPolicy,
  LedgerSealRecord,
} from '../../domain/ledger/manifest.js';
import {
  compareLedgerContent,
  hasDifference,
  sealPolicyOf,
  sealReadyAt,
  type LedgerDifference,
} from '../../domain/ledger/seal.js';
import { listDates } from '../../domain/ledger/verify.js';
import { errorMessage } from '../../domain/util/mask.js';
import { monthRange } from '../../domain/util/time.js';
import {
  DataUnavailableError,
  type BackfillSource,
  type Clock,
  type LedgerRepository,
  type LedgerStatusStore,
  type SealedMonthSink,
} from '../ports.js';
import { unitSnapshot } from './ledger-backfill.js';
import { recordRevisions, type LedgerRevisionNote } from './ledger.js';

export interface LedgerSealDeps {
  /** The backfill source of a dataset (U5); undefined for one that cannot be re-fetched. */
  source: (dataset: string) => BackfillSource | undefined;
  repository: LedgerRepository;
  hash: LedgerHasher;
  clock: Clock;
  status: LedgerStatusStore;
  /** Called after a successful seal (U7); none by default. */
  sinks?: readonly SealedMonthSink[] | undefined;
}

export interface LedgerSealRequest {
  month: string;
  /** The re-fetchable datasets, in fetch order. */
  datasets: readonly string[];
  /** `planBackfill` of the month for those datasets (what the APIs still serve of it). */
  plan: BackfillPlan;
}

/**
 * How one dataset fared:
 * - `match`: the re-fetched month equals the ledger
 * - `differs`: it does not (`compare` policy, or any policy on a sealed month)
 * - `replaced`: a roll-up that the API's calendar-month value replaces at the seal
 * - `blocked`: the ledger has the dataset but it cannot be re-fetched for the whole month
 * - `kept`: no history in the API (state, no backfill source); sealed as recorded
 * - `skipped`: neither in the ledger nor returned by the API
 */
export type SealCheckStatus = 'match' | 'differs' | 'replaced' | 'blocked' | 'kept' | 'skipped';

export interface SealDatasetCheck {
  dataset: string;
  policy: LedgerSealPolicy;
  status: SealCheckStatus;
  /** Rows re-fetched from the API. */
  fetched?: number | undefined;
  window?: { from: string; to: string } | undefined;
  difference?: LedgerDifference | undefined;
  reason?: string | undefined;
}

export interface LedgerSealResult {
  month: string;
  outcome: SealOutcome;
  checks: SealDatasetCheck[];
  /** New revision entries (only when the month was sealed already). */
  revisions: LedgerRevisionNote[];
  /** Why the month was not sealed, or what differed (counts, datasets, dates). */
  reasons: string[];
  /** The manifest written by the seal; null when nothing was sealed now. */
  manifest: LedgerManifest | null;
  sinkFailures: { id: string; reason: string }[];
}

interface Checked {
  check: SealDatasetCheck;
  /** Normalized re-fetched entries of the month (for `replaced` and revisions). */
  entries: LedgerEntry[];
}

interface SealContext {
  request: LedgerSealRequest;
  deps: LedgerSealDeps;
  startedAt: Date;
  /** Datasets that have a file in the month. */
  stored: ReadonlySet<string>;
  sealed: boolean;
}

const coversMonth = (unit: BackfillUnit, month: string): boolean => {
  const { start, end } = monthRange(month);
  return (
    unit.range.start.getTime() === start.getTime() && unit.range.end.getTime() === end.getTime()
  );
};

/** A dataset that cannot be re-fetched: blocks the seal only when the ledger holds it. */
function unfetchable(dataset: string, ctx: SealContext, reason: string): Checked {
  const status = ctx.stored.has(dataset) ? 'blocked' : 'skipped';
  return { check: { dataset, policy: sealPolicyOf(dataset), status, reason }, entries: [] };
}

/** Fetches the whole month of one dataset into memory (never into the ledger). */
async function fetchMonth(unit: BackfillUnit, source: BackfillSource, ctx: SealContext) {
  const result = await source.fetch(unit.range, ctx.startedAt);
  const snapshot = unitSnapshot(unit, source, result, ctx.startedAt.toISOString());
  const placed = ledgerEntriesOf(snapshot, ctx.deps.hash).entries.filter(
    (e) => e.month === unit.month && e.dataset === unit.dataset,
  );
  return {
    entries: mergeLedgerEntries(
      unit.dataset,
      placed.map((p) => p.entry),
    ),
    fetched: result.items.length,
    window: { from: unit.range.start.toISOString(), to: unit.range.end.toISOString() },
  };
}

/** The status of a fetched dataset from its difference with the ledger. */
function statusOf(policy: LedgerSealPolicy, difference: LedgerDifference, sealed: boolean) {
  if (!hasDifference(difference)) return 'match';
  return policy === 'replace' && !sealed ? 'replaced' : 'differs';
}

async function checkDataset(dataset: string, ctx: SealContext): Promise<Checked> {
  const { month, plan } = ctx.request;
  const unit = plan.units.find((u) => u.dataset === dataset && u.month === month);
  if (!unit || !coversMonth(unit, month))
    return unfetchable(dataset, ctx, 'the API no longer (or not yet) serves the whole month');
  const source = ctx.deps.source(dataset);
  if (!source) return unfetchable(dataset, ctx, 'no backfill source');
  try {
    const { entries, fetched, window } = await fetchMonth(unit, source, ctx);
    const policy = sealPolicyOf(dataset);
    if (!ctx.stored.has(dataset) && entries.length === 0)
      return { check: { dataset, policy, status: 'skipped', fetched, reason: 'no data' }, entries };
    const stored = await ctx.deps.repository.read(month, dataset);
    const difference = compareLedgerContent(dataset, stored, entries);
    const status = statusOf(policy, difference, ctx.sealed);
    return { check: { dataset, policy, status, fetched, window, difference }, entries };
  } catch (error) {
    const reason = errorMessage(error);
    // Unavailable (no key or scope) is like no source; a failed request always blocks.
    if (error instanceof DataUnavailableError) return unfetchable(dataset, ctx, reason);
    return {
      check: { dataset, policy: sealPolicyOf(dataset), status: 'blocked', reason },
      entries: [],
    };
  }
}

const describeDifference = (d: LedgerDifference): string =>
  `${d.dataset}: ${String(d.missing)} missing, ${String(d.extra)} extra, ${String(d.changed)} changed row(s)${d.dates.length > 0 ? ` on ${listDates(d.dates)}` : ''}`;

/** One line per dataset that kept the month from being sealed (or that differed). */
function reasonsOf(checks: readonly SealDatasetCheck[]): string[] {
  return checks.flatMap((check) => {
    if (check.status === 'differs' && check.difference)
      return [describeDifference(check.difference)];
    if (check.status === 'blocked')
      return [`${check.dataset}: cannot be re-fetched (${check.reason ?? 'unknown'})`];
    return [];
  });
}

/** The seal record: per dataset its policy and, when re-fetched, the window and row count. */
function sealRecordOf(checks: readonly SealDatasetCheck[], sealedAt: Date): LedgerSealRecord {
  const datasets: LedgerSealRecord['datasets'] = {};
  for (const check of checks) {
    if (check.status === 'skipped') continue;
    datasets[check.dataset] = {
      policy: check.policy,
      ...(check.window ? { window: check.window, fetched: check.fetched ?? 0 } : {}),
    };
  }
  return { sealedAt: sealedAt.toISOString(), datasets };
}

async function deliverToSinks(
  sinks: readonly SealedMonthSink[],
  month: string,
  manifest: LedgerManifest,
): Promise<LedgerSealResult['sinkFailures']> {
  const failures: LedgerSealResult['sinkFailures'] = [];
  for (const sink of sinks) {
    try {
      await sink.deliver(month, manifest);
    } catch (error) {
      failures.push({ id: sink.id, reason: errorMessage(error) });
    }
  }
  return failures;
}

/** Unsealed month: seals it when nothing differs or blocks, otherwise writes nothing. */
async function sealUnsealed(ctx: SealContext, checked: readonly Checked[]) {
  const { month } = ctx.request;
  const checks = checked.map((c) => c.check);
  const reasons = reasonsOf(checks);
  if (ctx.stored.size === 0 && checks.every((c) => c.status === 'skipped'))
    reasons.push(`the ledger has no data for ${month}`);
  if (reasons.length > 0) return { outcome: 'not-sealed' as const, reasons, manifest: null };
  for (const { check, entries } of checked)
    if (check.status === 'replaced') await ctx.deps.repository.write(month, check.dataset, entries);
  const manifest = await ctx.deps.repository.seal(month, sealRecordOf(checks, ctx.startedAt));
  return { outcome: 'sealed' as const, reasons, manifest };
}

/** Sealed month: re-verified; differences are appended to `revisions/`, the files stay. */
async function reverifySealed(ctx: SealContext, checked: readonly Checked[]) {
  const revisions: LedgerRevisionNote[] = [];
  for (const { check, entries } of checked) {
    if (check.status !== 'differs') continue;
    const { month } = ctx.request;
    const count = await recordRevisions(ctx.deps.repository, month, check.dataset, entries);
    if (count > 0) revisions.push({ month, dataset: check.dataset, count });
  }
  const differs = checked.some((c) => c.check.status === 'differs');
  const reasons = reasonsOf(checked.map((c) => c.check));
  return { outcome: differs ? ('revised' as const) : ('verified' as const), reasons, revisions };
}

async function checkAll(ctx: SealContext): Promise<Checked[]> {
  const checked: Checked[] = [];
  for (const dataset of ctx.request.datasets) checked.push(await checkDataset(dataset, ctx));
  for (const dataset of [...ctx.stored].sort())
    if (!ctx.request.datasets.includes(dataset))
      checked.push({
        check: { dataset, policy: sealPolicyOf(dataset), status: 'kept' },
        entries: [],
      });
  return checked;
}

/**
 * `ledger seal` (#160 U6): re-fetches the whole month through the backfill sources and compares
 * it with the ledger. An unsealed month is sealed only when every re-fetchable dataset matches
 * (roll-ups take the API's calendar-month value); otherwise nothing is written. A sealed month is
 * re-verified: what differs goes to `revisions/`, never into its files. The attempt is recorded in
 * `STATUS.json`. Allowed from the month end plus the revision period.
 */
export async function sealLedgerMonth(
  request: LedgerSealRequest,
  deps: LedgerSealDeps,
): Promise<LedgerSealResult> {
  const startedAt = deps.clock.now();
  const ready = sealReadyAt(request.month);
  if (startedAt.getTime() < ready.getTime())
    throw new Error(
      `${request.month} can be sealed from ${ready.toISOString()} (after the revision period)`,
    );
  const manifest = await deps.repository.manifest(request.month);
  const ctx: SealContext = {
    request,
    deps,
    startedAt,
    stored: new Set(Object.keys(manifest?.datasets ?? {})),
    sealed: manifest?.sealed ?? false,
  };
  const checked = await checkAll(ctx);
  const base = { month: request.month, checks: checked.map((c) => c.check), sinkFailures: [] };
  const result: LedgerSealResult = ctx.sealed
    ? { ...base, ...(await reverifySealed(ctx, checked)), manifest: null }
    : { ...base, ...(await sealUnsealed(ctx, checked)), revisions: [] };
  if (result.manifest)
    result.sinkFailures = await deliverToSinks(deps.sinks ?? [], request.month, result.manifest);
  const status = await deps.status.load();
  status.seals[request.month] = {
    attemptedAt: startedAt.toISOString(),
    outcome: result.outcome,
    reasons: result.reasons,
  };
  await deps.status.save(status);
  return result;
}
