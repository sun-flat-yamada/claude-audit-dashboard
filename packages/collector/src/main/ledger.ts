import {
  errorMessage,
  latestLedgerRecord,
  updateLedger,
  type AuditSnapshot,
  type LedgerUpdateResult,
} from '@claude-audit/core';
import { allArchivedIds, readArchived } from '../adapters/storage/archive.js';
import { sha256Hex } from '../adapters/storage/ledger.js';
import type { Container } from './container.js';
import { ledgerBackfill, parseBackfillArgs } from './ledger-backfill.js';
import { LEDGER_KEY_ACTIONS } from './ledger-keys.js';
import { ledgerPush, parsePushArgs } from './ledger-push.js';
import { ledgerSeal, parseSealArgs } from './ledger-seal.js';
import { ledgerVerify, parseVerifyArgs } from './ledger-verify.js';

/** Snapshots merged in memory per batch during a bootstrap (about one month at 6-hour runs). */
export const BOOTSTRAP_BATCH = 120;

const repositoryOf = (c: Container) => c.ledger();

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
  for (const r of result.revisions)
    c.logger.warn(
      `Ledger: ${String(r.count)} ${r.dataset} entr(ies) for sealed ${r.month} added to revisions/`,
    );
  for (const [dataset, count] of Object.entries(result.rejected))
    c.logger.warn(`Ledger: ${String(count)} ${dataset} row(s) without a usable date were skipped`);
  for (const gap of result.gaps)
    c.logger.warn(
      `Ledger: ${gap.dataset} ${gap.date}: the ${gap.dimension} rows add up to ${String(gap.sum)}, the total row is ${String(gap.total)}`,
    );
}

const LEDGER_USAGE =
  'ledger <update [--snapshot <id>]|bootstrap|backfill --from <yyyy-mm> [--to <yyyy-mm>] [--datasets a,b] [--force]|seal [--month <yyyy-mm>] [--notify]|verify [--notify] [--json]|push [--month <yyyy-mm>|--all] [--notify]|keygen --out <file> [--pipeline]|encrypt [--all] [--identity <file>]|decrypt --identity <file> --out <dir> [--month <yyyy-mm>]>';

/**
 * Records the stored snapshots first, then backfills: the backfilled entries carry the backfill
 * time, from which the next `ledger update` continues, so nothing collected before it may be left.
 */
async function backfill(c: Container, args: readonly string[]): Promise<void> {
  const request = parseBackfillArgs(c, args);
  report(c, await ledgerUpdate(c));
  await ledgerBackfill(c, request);
}

/** Records the stored snapshots first, so the seal compares the API with everything collected. */
async function seal(c: Container, args: readonly string[]): Promise<void> {
  const request = parseSealArgs(args);
  report(c, await ledgerUpdate(c));
  await ledgerSeal(c, request);
}

/** The actions besides `update` / `bootstrap` (registry, no switch). */
const ACTIONS: Readonly<Record<string, (c: Container, args: readonly string[]) => Promise<void>>> =
  {
    backfill,
    seal,
    ...LEDGER_KEY_ACTIONS,
    verify: async (c, args) => {
      await ledgerVerify(c, parseVerifyArgs(args));
    },
    push: async (c, args) => {
      await ledgerPush(c, parsePushArgs(args));
    },
  };

export const ledgerCommand = {
  name: 'ledger',
  usage: LEDGER_USAGE,
  description:
    'Merge snapshots into the monthly ledger, backfill, seal, verify, copy sealed months to external storage, encrypt or decrypt it (data/ledger/<yyyy-mm>/, data/audit only)',
  async run(c: Container, args: readonly string[]): Promise<void> {
    const [action] = args;
    const handler = action ? ACTIONS[action] : undefined;
    if (handler) return handler(c, args.slice(1));
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
