import { z } from 'zod';
import { ledgerSpecFor } from './datasets.js';
import { compareText, type LedgerEntry } from './entry.js';
import { summarizeLedgerFile } from './ledger.js';

export const LEDGER_MANIFEST_SCHEMA_VERSION = 1;

const windowSchema = z.object({ from: z.string(), to: z.string() }).nullable();

export const ledgerManifestSchema = z.looseObject({
  schemaVersion: z.literal(LEDGER_MANIFEST_SCHEMA_VERSION),
  month: z.string(),
  /** Set by the seal step (U6); a sealed month is never rewritten by `ledger update`. */
  sealed: z.boolean(),
  lastRecordedAt: z.string().nullable(),
  datasets: z.record(
    z.string(),
    z.looseObject({
      kind: z.enum(['event', 'daily', 'rollup', 'state']),
      count: z.number().int().nonnegative(),
      /** SHA-256 (hex) of the uncompressed JSON Lines content of the file. */
      sha256: z.string(),
      window: windowSchema,
    }),
  ),
});

export type LedgerManifest = z.infer<typeof ledgerManifestSchema>;

export interface LedgerManifestFile {
  dataset: string;
  entries: readonly LedgerEntry[];
  sha256: string;
}

/**
 * `MANIFEST.json` of one month: per dataset its kind, entry count, content hash and covered
 * window. Derived from the files only (no clock), so an unchanged month gives an identical manifest.
 */
export function buildLedgerManifest(
  month: string,
  files: readonly LedgerManifestFile[],
  sealed = false,
): LedgerManifest {
  const datasets: LedgerManifest['datasets'] = {};
  let lastRecordedAt: string | null = null;
  for (const file of [...files].sort((a, b) => compareText(a.dataset, b.dataset))) {
    const spec = ledgerSpecFor(file.dataset);
    if (!spec) continue;
    const summary = summarizeLedgerFile(file.dataset, file.entries);
    datasets[file.dataset] = {
      kind: spec.kind,
      count: summary.count,
      sha256: file.sha256,
      window: summary.window,
    };
    const last = summary.lastRecordedAt;
    if (last !== null && (lastRecordedAt === null || last > lastRecordedAt)) lastRecordedAt = last;
  }
  return { schemaVersion: LEDGER_MANIFEST_SCHEMA_VERSION, month, sealed, lastRecordedAt, datasets };
}
