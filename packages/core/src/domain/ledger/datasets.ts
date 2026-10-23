import type { DatasetName } from '../model/dataset.js';
import type { LedgerDatasetSpec, LedgerKeyFn } from './kinds.js';

type Row = Record<string, unknown>;

/** Joins key parts with `|`; a missing part is empty (`total` rows have no key). */
const parts =
  (...names: readonly string[]): LedgerKeyFn =>
  (item: Row) =>
    names.map((name) => String(item[name] ?? '')).join('|');

const createdAt: LedgerKeyFn = (item) => String(item.createdAt ?? '');

const STATE: LedgerDatasetSpec = { kind: 'state' };

/** Datasets derived from the ledger itself; never recorded in it. */
export const NON_LEDGER_DATASETS = ['ledgerHealth'] as const satisfies readonly DatasetName[];

type LedgerDatasetName = Exclude<DatasetName, (typeof NON_LEDGER_DATASETS)[number]>;

/**
 * The ledger kind of every dataset. The `Record<…>` type makes a new dataset fail the type check
 * until it is classified here (or listed in `NON_LEDGER_DATASETS`).
 */
const BUILTIN_LEDGER_DATASETS: Readonly<Record<LedgerDatasetName, LedgerDatasetSpec>> = {
  activities: { kind: 'event', time: createdAt },
  usage: { kind: 'daily', key: parts('date', 'dimension', 'key') },
  cost: { kind: 'daily', key: parts('date', 'dimension', 'key') },
  adoption: { kind: 'daily', key: parts('date', 'dimension', 'key') },
  consoleUsage: { kind: 'daily', key: parts('date', 'workspaceId', 'model') },
  consoleCost: { kind: 'daily', key: parts('date', 'workspaceId', 'model', 'costType') },
  claudeCodeActivity: {
    kind: 'daily',
    key: parts('date', 'actorKind', 'actor', 'terminalType', 'customerType'),
  },
  memberActivity: { kind: 'rollup', key: parts('userId') },
  memberActivityDaily: { kind: 'daily', key: parts('date', 'userId') },
  credentialUsage: { kind: 'rollup', key: parts('credentialId') },
  skillUsage: { kind: 'rollup', key: parts('name') },
  connectorUsage: { kind: 'rollup', key: parts('name') },
  pluginUsage: { kind: 'rollup', key: parts('name', 'pluginId') },
  chatProjectUsage: { kind: 'rollup', key: parts('id') },
  organizations: STATE,
  members: STATE,
  invites: STATE,
  groups: STATE,
  settings: STATE,
  credentials: STATE,
  spendLimits: STATE,
  consoleWorkspaces: STATE,
  consoleApiKeys: STATE,
};

const LEDGER_DATASETS = new Map<string, LedgerDatasetSpec>(Object.entries(BUILTIN_LEDGER_DATASETS));

/** Classifies (or reclassifies) a dataset for the ledger; e.g. a new daily dataset (U4). */
export function registerLedgerDataset(dataset: DatasetName, spec: LedgerDatasetSpec): void {
  LEDGER_DATASETS.set(dataset, spec);
}

/** The ledger spec of a dataset; null for a name the ledger does not know. */
export const ledgerSpecFor = (dataset: string): LedgerDatasetSpec | null =>
  LEDGER_DATASETS.get(dataset) ?? null;

/** Every dataset the ledger records, in name order. */
export const ledgerDatasetNames = (): string[] => [...LEDGER_DATASETS.keys()].sort();
