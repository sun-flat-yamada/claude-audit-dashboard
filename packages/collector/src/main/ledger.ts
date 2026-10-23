import {
  errorMessage,
  latestLedgerRecord,
  updateLedger,
  type AuditSnapshot,
  type LedgerUpdateResult,
} from '@claude-audit/core';
import { allArchivedIds, readArchived } from '../adapters/storage/archive.js';
import { FsLedgerRepository, sha256Hex } from '../adapters/storage/ledger.js';
import type { Container } from './container.js';

/** Snapshots merged in memory per batch during a bootstrap (about one month at 6-hour runs). */
export const BOOTSTRAP_BATCH = 120;

const repositoryOf = (c: Container) => new FsLedgerRepository(c.store);

/**
 * Snapshots `ledger update` records: the one asked for, else every stored snapshot from the
 * last recorded collection on (it is merged again, which is a no-op), so a run that failed is
 * caught up by the next one. An empty ledger starts with the latest snapshot (see `bootstrap`).
 */
async function snapshotsToRecord(c: Container, snapshotId?: string): Promise<AuditSnapshot[]> {
  if (snapshotId) {
    const snapshot = await c.snapshots.load(snapshotId);
    if (!snapshot) throw new Error(`Snapshot not found: ${snapshotId}`);
    return [snapshot];
  }
  const since = await latestLedgerRecord(repositoryOf(c));
  if (since) return c.snapshots.since(new Date(since));
  const latest = await c.snapshots.latest();
  return latest ? [latest] : [];
}

export async function ledgerUpdate(c: Container, snapshotId?: string): Promise<LedgerUpdateResult> {
  return updateLedger(await snapshotsToRecord(c, snapshotId), {
    repository: repositoryOf(c),
    hash: sha256Hex,
  });
}

/** Every archived and stored snapshot in id order; a stored snapshot wins over its archive. */
async function* everySnapshot(c: Container): AsyncGenerator<AuditSnapshot> {
  const stored = new Set(await c.snapshots.ids());
  const ids = [...new Set([...(await allArchivedIds(c.store)), ...stored])].sort();
  for (const id of ids) {
    const snapshot = stored.has(id) ? await c.snapshots.load(id) : null;
    yield snapshot ?? (await readArchived(c.store, id));
  }
}

/** Builds (or completes) the ledger from `snapshots/` and `archive/<year>/*.json.gz`. */
export function ledgerBootstrap(c: Container): Promise<LedgerUpdateResult> {
  return updateLedger(everySnapshot(c), {
    repository: repositoryOf(c),
    hash: sha256Hex,
    batchSize: BOOTSTRAP_BATCH,
  });
}

function report(c: Container, result: LedgerUpdateResult): void {
  c.logger.info(
    `Ledger: ${String(result.snapshots)} snapshot(s) read, ${String(result.changed.length)} file(s) changed, ${String(result.manifests.length)} manifest(s) written`,
  );
  if (result.sealed.length > 0)
    c.logger.warn(`Ledger: sealed month(s) left unchanged: ${result.sealed.join(', ')}`);
  for (const [dataset, count] of Object.entries(result.rejected))
    c.logger.warn(`Ledger: ${String(count)} ${dataset} row(s) without a usable date were skipped`);
}

const LEDGER_USAGE = 'ledger <update [--snapshot <id>]|bootstrap>';

export const ledgerCommand = {
  name: 'ledger',
  usage: LEDGER_USAGE,
  description: 'Merge snapshots into the monthly ledger (data/ledger/<yyyy-mm>/, data/audit only)',
  async run(c: Container, args: readonly string[]): Promise<void> {
    const [action] = args;
    const at = args.indexOf('--snapshot');
    const snapshotId = at >= 0 ? args[at + 1] : undefined;
    if (at >= 0 && (!snapshotId || snapshotId.startsWith('--')))
      throw new Error('--snapshot requires a value');
    if (action === 'update') return report(c, await ledgerUpdate(c, snapshotId));
    if (action === 'bootstrap' && at < 0) return report(c, await ledgerBootstrap(c));
    throw new Error(`Usage: ${LEDGER_USAGE}`);
  },
};

/** The last `pipeline` step: never fails the collection; the next run catches up. */
export const ledgerPipelineStep = {
  name: 'ledger-update',
  async run(c: Container): Promise<void> {
    try {
      report(c, await ledgerUpdate(c));
    } catch (error) {
      c.logger.warn(`Ledger update failed (the next run catches up): ${errorMessage(error)}`);
    }
  },
};
