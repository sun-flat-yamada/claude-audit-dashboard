import { z } from 'zod';
import { compareText } from './entry.js';
import type { LedgerManifest } from './manifest.js';
import { ledgerFindingSchema, type LedgerFinding } from './verify.js';

export const LEDGER_STATUS_SCHEMA_VERSION = 1;

/**
 * What a seal attempt ended with:
 * - `sealed`: the re-fetched month matched (or was adopted) and the month is sealed now
 * - `not-sealed`: a difference or a dataset that could not be re-fetched kept it unsealed
 * - `verified`: an already sealed month was re-fetched and matched
 * - `revised`: an already sealed month differed; the differences went to `revisions/`
 */
export const SEAL_OUTCOMES = ['sealed', 'not-sealed', 'verified', 'revised'] as const;
export type SealOutcome = (typeof SEAL_OUTCOMES)[number];

const sealAttemptSchema = z.object({
  attemptedAt: z.string(),
  outcome: z.enum(SEAL_OUTCOMES),
  /** Why the month was not sealed (counts, datasets, dates; no identities). */
  reasons: z.array(z.string()),
});

const verifySchema = z.object({
  checkedAt: z.string(),
  status: z.enum(['pass', 'fail']),
  /** First check of the current run of failures; null while passing. */
  failingSince: z.string().nullable(),
  findings: z.array(ledgerFindingSchema),
  lastRecordedAt: z.string().nullable(),
});

/** `ledger/STATUS.json`: the last verification, the last seal attempt per month, notified revisions. */
export const ledgerStatusSchema = z.object({
  schemaVersion: z.literal(LEDGER_STATUS_SCHEMA_VERSION),
  verify: verifySchema.nullable(),
  seals: z.record(z.string(), sealAttemptSchema),
  /** Revision entries per month that were already notified. */
  notifiedRevisions: z.record(z.string(), z.number().int().nonnegative()),
});

export type LedgerStatus = z.infer<typeof ledgerStatusSchema>;
export type LedgerVerifyRecord = z.infer<typeof verifySchema>;
export type LedgerSealAttempt = z.infer<typeof sealAttemptSchema>;

export const emptyLedgerStatus = (): LedgerStatus => ({
  schemaVersion: LEDGER_STATUS_SCHEMA_VERSION,
  verify: null,
  seals: {},
  notifiedRevisions: {},
});

/** One ledger month as the operational rules see it. */
export interface LedgerMonthHealth {
  month: string;
  sealed: boolean;
  sealedAt: string | null;
  /** Revision entries recorded after the seal. */
  revisions: number;
  lastSeal: Pick<LedgerSealAttempt, 'attemptedAt' | 'outcome'> | null;
}

/**
 * The `ledgerHealth` dataset row (OP-003 / OP-004): the last verification and the state of every
 * month. Derived from `STATUS.json` and the manifests; never recorded in the ledger itself.
 */
export interface LedgerHealth {
  verifiedAt: string | null;
  status: 'pass' | 'fail' | null;
  failingSince: string | null;
  findings: LedgerFinding[];
  lastRecordedAt: string | null;
  months: LedgerMonthHealth[];
}

/** Revision entries of a manifest, over all datasets. */
export const revisionCount = (manifest: LedgerManifest | null): number =>
  Object.values(manifest?.revisions ?? {}).reduce((sum, r) => sum + r.count, 0);

export interface MonthManifest {
  month: string;
  manifest: LedgerManifest | null;
}

const monthHealth = (
  month: string,
  manifest: LedgerManifest | null,
  attempt: LedgerSealAttempt | undefined,
): LedgerMonthHealth => ({
  month,
  sealed: manifest?.sealed ?? false,
  sealedAt: manifest?.seal?.sealedAt ?? null,
  revisions: revisionCount(manifest),
  lastSeal: attempt ? { attemptedAt: attempt.attemptedAt, outcome: attempt.outcome } : null,
});

const NOT_VERIFIED: Omit<LedgerHealth, 'months'> = {
  verifiedAt: null,
  status: null,
  failingSince: null,
  findings: [],
  lastRecordedAt: null,
};

const verifyPart = (verify: LedgerVerifyRecord | null): Omit<LedgerHealth, 'months'> =>
  verify
    ? {
        verifiedAt: verify.checkedAt,
        status: verify.status,
        failingSince: verify.failingSince,
        findings: verify.findings,
        lastRecordedAt: verify.lastRecordedAt,
      }
    : NOT_VERIFIED;

/** The health row of a ledger; null when there is neither a month nor a status yet. */
export function ledgerHealthOf(
  status: LedgerStatus,
  manifests: readonly MonthManifest[],
): LedgerHealth | null {
  const known = new Set([...manifests.map((m) => m.month), ...Object.keys(status.seals)]);
  if (known.size === 0 && status.verify === null) return null;
  const byMonth = new Map(manifests.map((m) => [m.month, m.manifest]));
  const months = [...known]
    .sort(compareText)
    .map((month) => monthHealth(month, byMonth.get(month) ?? null, status.seals[month]));
  return { ...verifyPart(status.verify), months };
}
