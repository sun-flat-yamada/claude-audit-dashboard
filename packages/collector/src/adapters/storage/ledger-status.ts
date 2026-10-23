import {
  emptyLedgerStatus,
  ledgerHealthOf,
  ledgerStatusSchema,
  type DatasetCollector,
  type LedgerStatus,
  type LedgerStatusStore,
} from '@claude-audit/core';
import type { FileStore } from './file-store.js';
import { FsLedgerRepository, LEDGER_DIR } from './ledger.js';

/** The last verification and seal attempts next to the month directories (data/audit only). */
export const LEDGER_STATUS = `${LEDGER_DIR}/STATUS.json`;

/**
 * `ledger/STATUS.json` (#160 U6). A missing file is an empty status; an unreadable one stops the
 * command and is never overwritten (delete it to start over).
 */
export class FsLedgerStatusStore implements LedgerStatusStore {
  constructor(private readonly store: FileStore) {}

  async load(): Promise<LedgerStatus> {
    const raw = await this.store.readJson(LEDGER_STATUS);
    if (raw === null) return emptyLedgerStatus();
    const parsed = ledgerStatusSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Unreadable ledger status ${LEDGER_STATUS}`);
    return parsed.data;
  }

  save(status: LedgerStatus): Promise<void> {
    return this.store.writeJson(LEDGER_STATUS, status);
  }
}

/**
 * The local `ledgerHealth` collector: one row from `STATUS.json` and the month manifests (OP-003 /
 * OP-004), none while there is no ledger. Reads the data directory only, so it is always `ok`.
 */
export function ledgerHealthCollector(store: FileStore): DatasetCollector<'ledgerHealth'> {
  return {
    dataset: 'ledgerHealth',
    source: 'local:data/ledger',
    async collect() {
      const repository = new FsLedgerRepository(store);
      const manifests = [];
      for (const month of await repository.months())
        manifests.push({ month, manifest: await repository.manifest(month) });
      const health = ledgerHealthOf(await new FsLedgerStatusStore(store).load(), manifests);
      return { items: health ? [health] : [] };
    },
  };
}
