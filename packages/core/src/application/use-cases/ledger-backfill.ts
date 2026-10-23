import {
  backfillUnitKey,
  isFinalBackfill,
  type BackfillPlan,
  type BackfillUnit,
} from '../../domain/ledger/backfill.js';
import type { LedgerHasher } from '../../domain/ledger/entry.js';
import type { DatasetName } from '../../domain/model/dataset.js';
import { SNAPSHOT_SCHEMA_VERSION, type AuditSnapshot } from '../../domain/model/snapshot.js';
import { errorMessage } from '../../domain/util/mask.js';
import {
  DataUnavailableError,
  type BackfillProgress,
  type BackfillProgressStore,
  type BackfillSource,
  type Clock,
  type CollectResult,
  type LedgerRepository,
} from '../ports.js';
import { updateLedger, type LedgerUpdateResult } from './ledger.js';

export interface LedgerBackfillDeps {
  /** The source of a dataset; undefined for a dataset that cannot be backfilled. */
  source: (dataset: string) => BackfillSource | undefined;
  repository: LedgerRepository;
  hash: LedgerHasher;
  progress: BackfillProgressStore;
  clock: Clock;
  /** Fetch every unit again, even the ones a previous run completed after their revisions. */
  force?: boolean;
  /** Called after each unit (progress output). */
  onUnit?: (outcome: BackfillOutcome) => void;
}

export type BackfillOutcome =
  | { unit: BackfillUnit; status: 'fetched'; count: number }
  | { unit: BackfillUnit; status: 'skipped' }
  | { unit: BackfillUnit; status: 'unavailable' | 'failed'; reason: string };

export interface LedgerBackfillResult {
  outcomes: BackfillOutcome[];
  /** Ledger changes of all fetched units together. */
  ledger: LedgerUpdateResult;
}

const emptyLedgerResult = (): LedgerUpdateResult => ({
  snapshots: 0,
  changed: [],
  manifests: [],
  sealed: [],
  rejected: {},
  gaps: [],
});

const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])];

function addLedgerResult(total: LedgerUpdateResult, part: LedgerUpdateResult): void {
  total.snapshots += part.snapshots;
  total.changed = union(total.changed, part.changed);
  total.manifests = union(total.manifests, part.manifests);
  total.sealed = union(total.sealed, part.sealed).sort();
  for (const [dataset, count] of Object.entries(part.rejected))
    total.rejected[dataset] = (total.rejected[dataset] ?? 0) + count;
  total.gaps.push(...part.gaps);
}

/**
 * One fetched unit as an in-memory snapshot holding only that dataset, collected `ok`. Its
 * collection time is the start of the backfill run, so every unit of a run merges alike.
 */
function unitSnapshot(
  unit: BackfillUnit,
  source: BackfillSource,
  result: CollectResult<unknown[]>,
  startedAt: string,
): AuditSnapshot {
  const dataset = unit.dataset as DatasetName;
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: `backfill-${unit.month}-${unit.dataset}`,
    collectedAt: startedAt,
    coverage: {
      [dataset]: {
        status: 'ok',
        source: result.source ?? source.source,
        count: result.items.length,
        window: result.window ?? {
          from: unit.range.start.toISOString(),
          to: unit.range.end.toISOString(),
        },
        asOf: result.asOf,
      },
    },
    data: { [dataset]: result.items } as AuditSnapshot['data'],
  };
}

interface RunContext {
  deps: LedgerBackfillDeps;
  progress: BackfillProgress;
  startedAt: Date;
  ledger: LedgerUpdateResult;
}

/** Fetches one unit, merges it into the ledger and records it in the progress store. */
async function runUnit(unit: BackfillUnit, run: RunContext): Promise<BackfillOutcome> {
  const { deps, progress } = run;
  const key = backfillUnitKey(unit);
  const record = progress.units[key];
  if (!deps.force && record && isFinalBackfill(record, unit.range))
    return { unit, status: 'skipped' };
  const source = deps.source(unit.dataset);
  if (!source) return { unit, status: 'unavailable', reason: 'no backfill source' };
  try {
    const result = await source.fetch(unit.range, run.startedAt);
    const snapshot = unitSnapshot(unit, source, result, run.startedAt.toISOString());
    addLedgerResult(
      run.ledger,
      await updateLedger([snapshot], { repository: deps.repository, hash: deps.hash }),
    );
    progress.units[key] = {
      from: unit.range.start.toISOString(),
      to: unit.range.end.toISOString(),
      completedAt: deps.clock.now().toISOString(),
      count: result.items.length,
    };
    await deps.progress.save(progress);
    return { unit, status: 'fetched', count: result.items.length };
  } catch (error) {
    const status = error instanceof DataUnavailableError ? 'unavailable' : 'failed';
    return { unit, status, reason: errorMessage(error) };
  }
}

/**
 * Runs a backfill plan unit by unit, oldest month first. Each unit is merged into the ledger and
 * recorded as soon as it is fetched, so an interrupted run loses at most the unit in flight; a
 * re-run fetches again everything that is not final (the merge rules are idempotent, so a
 * repeated unit changes nothing). A failing unit does not stop the others.
 */
export async function backfillLedger(
  plan: BackfillPlan,
  deps: LedgerBackfillDeps,
): Promise<LedgerBackfillResult> {
  const run: RunContext = {
    deps,
    progress: await deps.progress.load(),
    startedAt: deps.clock.now(),
    ledger: emptyLedgerResult(),
  };
  const outcomes: BackfillOutcome[] = [];
  for (const unit of plan.units) {
    const outcome = await runUnit(unit, run);
    outcomes.push(outcome);
    deps.onUnit?.(outcome);
  }
  return { outcomes, ledger: run.ledger };
}
