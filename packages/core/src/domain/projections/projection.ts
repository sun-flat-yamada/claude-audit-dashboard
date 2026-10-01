import type { DatasetMap, DatasetName, TimeWindow } from '../model/dataset.js';

/**
 * A dataset derived across snapshots. It receives the state it returned last time,
 * so it can accumulate facts (e.g. "last seen") that no single API call provides.
 */
export interface Projection<K extends DatasetName = DatasetName> {
  readonly dataset: K;
  readonly requires: readonly DatasetName[];
  reduce(input: { previous: unknown; data: DatasetMap; now: Date }): {
    state: unknown;
    items: DatasetMap[K];
    window: TimeWindow;
  };
}
