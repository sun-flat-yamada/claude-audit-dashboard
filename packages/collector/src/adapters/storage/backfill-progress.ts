import type { BackfillProgress, BackfillProgressStore } from '@claude-audit/core';
import { z } from 'zod';
import type { FileStore } from './file-store.js';
import { LEDGER_DIR } from './ledger.js';

/** Progress of `ledger backfill` next to the month directories (data/audit only). */
export const BACKFILL_PROGRESS = `${LEDGER_DIR}/BACKFILL.json`;

const progressSchema = z.object({
  schemaVersion: z.literal(1),
  units: z.record(
    z.string(),
    z.object({
      from: z.string(),
      to: z.string(),
      completedAt: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
});

/**
 * `ledger/BACKFILL.json`: one record per fetched (month, dataset) unit, so a re-run can skip the
 * final ones. A missing file is an empty progress; an unreadable one stops the run and is never
 * overwritten (delete it to start over).
 */
export class FsBackfillProgressStore implements BackfillProgressStore {
  constructor(private readonly store: FileStore) {}

  async load(): Promise<BackfillProgress> {
    const raw = await this.store.readJson(BACKFILL_PROGRESS);
    if (raw === null) return { schemaVersion: 1, units: {} };
    const parsed = progressSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Unreadable backfill progress ${BACKFILL_PROGRESS}`);
    return parsed.data;
  }

  save(progress: BackfillProgress): Promise<void> {
    return this.store.writeJson(BACKFILL_PROGRESS, progress);
  }
}
