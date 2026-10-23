import { z } from 'zod';
import { ledgerSpecFor } from './datasets.js';
import { compareText, type LedgerEntry } from './entry.js';
import { summarizeLedgerFile } from './ledger.js';

export const LEDGER_MANIFEST_SCHEMA_VERSION = 1;

const windowSchema = z.object({ from: z.string(), to: z.string() }).nullable();

/** How the seal treated one dataset (#160 U6). */
export const SEAL_POLICIES = ['compare', 'replace', 'keep'] as const;
export type LedgerSealPolicy = (typeof SEAL_POLICIES)[number];

const sealSchema = z.looseObject({
  sealedAt: z.string(),
  /** Per dataset: the policy, and for a re-fetched one the fetched window and row count. */
  datasets: z.record(
    z.string(),
    z.looseObject({
      policy: z.enum(SEAL_POLICIES),
      window: windowSchema.optional(),
      fetched: z.number().int().nonnegative().optional(),
    }),
  ),
});

const revisionSchema = z.looseObject({
  count: z.number().int().nonnegative(),
  /** SHA-256 (hex) of the uncompressed JSON Lines content of `revisions/<dataset>`. */
  sha256: z.string(),
  lastRecordedAt: z.string().nullable(),
});

export const ledgerManifestSchema = z.looseObject({
  schemaVersion: z.literal(LEDGER_MANIFEST_SCHEMA_VERSION),
  month: z.string(),
  /** Set by `ledger seal` (U6); a sealed month is never rewritten, later changes go to `revisions/`. */
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
  seal: sealSchema.optional(),
  /** Entries that arrived after the seal and would have changed a file (never merged into it). */
  revisions: z.record(z.string(), revisionSchema).optional(),
});

export type LedgerManifest = z.infer<typeof ledgerManifestSchema>;
export type LedgerSealRecord = z.infer<typeof sealSchema>;
export type LedgerRevisionSummary = z.infer<typeof revisionSchema>;

export interface LedgerManifestFile {
  dataset: string;
  entries: readonly LedgerEntry[];
  sha256: string;
}

/** What a refreshed manifest keeps of the previous one (the seal and the revisions). */
export type LedgerManifestCarry = Partial<Pick<LedgerManifest, 'sealed' | 'seal' | 'revisions'>>;

/**
 * `MANIFEST.json` of one month: per dataset its kind, entry count, content hash and covered
 * window. Derived from the files only (no clock), so an unchanged month gives an identical
 * manifest; the seal record and the revision list are carried over from `carry`.
 */
function summarizeFiles(files: readonly LedgerManifestFile[]) {
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
  return { datasets, lastRecordedAt };
}

/** The seal record and a non-empty revision list of `carry`, when present. */
const carried = (carry: LedgerManifestCarry): Pick<LedgerManifest, 'seal' | 'revisions'> => ({
  ...(carry.seal ? { seal: carry.seal } : {}),
  ...(carry.revisions && Object.keys(carry.revisions).length > 0
    ? { revisions: carry.revisions }
    : {}),
});

export function buildLedgerManifest(
  month: string,
  files: readonly LedgerManifestFile[],
  carry: LedgerManifestCarry | boolean = {},
): LedgerManifest {
  const kept = typeof carry === 'boolean' ? { sealed: carry } : carry;
  const { datasets, lastRecordedAt } = summarizeFiles(files);
  return {
    schemaVersion: LEDGER_MANIFEST_SCHEMA_VERSION,
    month,
    sealed: kept.sealed ?? false,
    lastRecordedAt,
    datasets,
    ...carried(kept),
  };
}
