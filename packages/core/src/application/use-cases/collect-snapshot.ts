import {
  missingRequirements,
  withDefaults,
  type Coverage,
  type DatasetData,
  type DatasetMeta,
  type DatasetName,
} from '../../domain/model/dataset.js';
import { SNAPSHOT_SCHEMA_VERSION, type AuditSnapshot } from '../../domain/model/snapshot.js';
import type { Projection } from '../../domain/projections/projection.js';
import { errorMessage } from '../../domain/util/mask.js';
import { addDays, startOfUtcDay, timestampId, type DateRange } from '../../domain/util/time.js';
import {
  DataUnavailableError,
  type Clock,
  type CollectContext,
  type DatasetCollector,
  type SnapshotRepository,
  type StateRepository,
} from '../ports.js';
import type { CollectorState } from '../state.js';

/** Default period for time-bounded datasets: the last 30 full days plus today. */
export const defaultRange = (now: Date): DateRange => ({
  start: startOfUtcDay(addDays(now, -30)),
  end: now,
});

export interface Gathered {
  data: DatasetData;
  coverage: Coverage;
  cursors: Record<string, unknown>;
}

interface CollectorOutcome {
  dataset: DatasetName;
  meta: DatasetMeta;
  items?: unknown[];
  cursor?: unknown;
}

async function runCollector(
  collector: DatasetCollector,
  context: CollectContext,
): Promise<CollectorOutcome> {
  try {
    const result = await collector.collect(context);
    const meta: DatasetMeta = {
      status: 'ok',
      source: result.source ?? collector.source,
      count: result.items.length,
      window: result.window,
      asOf: result.asOf,
    };
    return { dataset: collector.dataset, meta, items: result.items, cursor: result.cursor };
  } catch (error) {
    const status = error instanceof DataUnavailableError ? 'unavailable' : 'error';
    const meta: DatasetMeta = { status, source: collector.source, reason: errorMessage(error) };
    return { dataset: collector.dataset, meta };
  }
}

/** Runs every collector in isolation: one failing dataset never stops the others. */
export async function gatherDatasets(
  collectors: readonly DatasetCollector[],
  context: Omit<CollectContext, 'cursor'>,
  cursors: Readonly<Record<string, unknown>> = {},
): Promise<Gathered> {
  const outcomes = await Promise.all(
    collectors.map((c) => runCollector(c, { ...context, cursor: cursors[c.dataset] })),
  );
  const gathered: Gathered = { data: {}, coverage: {}, cursors: { ...cursors } };
  for (const outcome of outcomes) {
    gathered.coverage[outcome.dataset] = outcome.meta;
    if (outcome.items) (gathered.data as Record<string, unknown>)[outcome.dataset] = outcome.items;
    if (outcome.cursor !== undefined) gathered.cursors[outcome.dataset] = outcome.cursor;
  }
  return gathered;
}

/** Adds derived datasets; returns the projection states to persist. */
export function applyProjections(
  projections: readonly Projection[],
  gathered: Gathered,
  previous: Readonly<Record<string, unknown>>,
  now: Date,
): Record<string, unknown> {
  const states: Record<string, unknown> = { ...previous };
  for (const projection of projections) {
    const source = `projection:${projection.dataset}`;
    const missing = missingRequirements(projection.requires, gathered.coverage);
    if (missing) {
      gathered.coverage[projection.dataset] = { status: 'unavailable', source, reason: missing };
      continue;
    }
    const data = withDefaults(gathered.data);
    const result = projection.reduce({ previous: previous[projection.dataset], data, now });
    states[projection.dataset] = result.state;
    (gathered.data as Record<string, unknown>)[projection.dataset] = result.items;
    gathered.coverage[projection.dataset] = {
      status: 'ok',
      source,
      count: result.items.length,
      window: result.window,
    };
  }
  return states;
}

export interface CollectSnapshotDeps {
  collectors: readonly DatasetCollector[];
  projections: readonly Projection[];
  snapshots: SnapshotRepository;
  state: StateRepository;
  clock: Clock;
  range?: DateRange | undefined;
}

/** Collects every dataset, derives projections, stores the snapshot, then advances state. */
export async function collectSnapshot(deps: CollectSnapshotDeps): Promise<AuditSnapshot> {
  const now = deps.clock.now();
  const state = await deps.state.load();
  const range = deps.range ?? defaultRange(now);
  const gathered = await gatherDatasets(deps.collectors, { now, range }, state.cursors);
  const projections = applyProjections(deps.projections, gathered, state.projections, now);
  const snapshot: AuditSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: timestampId(now),
    collectedAt: now.toISOString(),
    coverage: gathered.coverage,
    data: gathered.data,
  };
  await deps.snapshots.save(snapshot);
  const next: CollectorState = {
    ...state,
    collections: { count: state.collections.count + 1, lastAt: snapshot.collectedAt },
    cursors: gathered.cursors,
    projections,
  };
  await deps.state.save(next);
  return snapshot;
}
