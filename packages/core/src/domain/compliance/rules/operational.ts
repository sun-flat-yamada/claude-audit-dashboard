import { z } from 'zod';
import type { LedgerHealth, LedgerMonthHealth } from '../../ledger/health.js';
import type { DatasetMeta } from '../../model/dataset.js';
import { round } from '../../util/numbers.js';
import { DAY_MS, HOUR_MS, monthRange } from '../../util/time.js';
import { defineRule } from '../define-rule.js';
import { fail, failIfAny, pass, skip, warn, type Evidence } from '../types.js';

export const collectionFreshness = defineRule({
  meta: {
    id: 'OP-001',
    name: 'Collection Freshness',
    category: 'operational',
    severity: 'high',
    description: 'Time since the evaluated snapshot was collected',
    remediation:
      'Check the collect-audit workflow runs, secrets and the ENABLE_SCHEDULED_JOBS variable.',
  },
  requires: [],
  params: z.object({ maxStaleHours: z.number().positive().default(24) }),
  evaluate({ snapshot, params, now }) {
    const hours = round((now.getTime() - Date.parse(snapshot.collectedAt)) / HOUR_MS, 1);
    if (hours > params.maxStaleHours) {
      return fail(`Last collection ${hours}h ago (max ${params.maxStaleHours}h)`);
    }
    return pass(`Last collection ${hours}h ago`);
  },
});

export const dataSourceCoverage = defineRule({
  meta: {
    id: 'OP-002',
    name: 'Data Source Coverage',
    category: 'operational',
    severity: 'high',
    description:
      'Datasets that could not be collected (missing key or scope, disabled API, API error or schema drift)',
    remediation:
      'Grant the scopes listed in docs/SETUP.md, enable the API in claude.ai, or disable the data source in config.',
  },
  requires: [],
  params: z.object({ ignore: z.array(z.string()).default([]) }),
  evaluate({ coverage, params }) {
    const entries = Object.entries(coverage) as [string, DatasetMeta][];
    if (entries.length === 0) return skip('No data source is configured');
    return failIfAny(
      entries.filter(([name, meta]) => meta.status !== 'ok' && !params.ignore.includes(name)),
      {
        pass: `All ${entries.length} datasets collected`,
        fail: (n) => `${n} of ${entries.length} dataset(s) not collected`,
      },
      ([name, meta]) => ({
        kind: 'dataset',
        id: name,
        label: `${meta.status}: ${meta.reason ?? 'no reason reported'}`,
      }),
    );
  },
});

const ledgerOf = (rows: readonly LedgerHealth[]): LedgerHealth | null => rows[0] ?? null;

export const ledgerVerification = defineRule({
  meta: {
    id: 'OP-003',
    name: 'Ledger Verification',
    category: 'operational',
    severity: 'high',
    description:
      'Result of the daily `ledger verify`: missing days, stale collection, sealed-month hashes',
    remediation:
      'Run the Ledger Verify workflow and see its findings; fill gaps with pnpm ledger backfill (docs/DEPLOYMENT.md).',
  },
  requires: ['ledgerHealth'],
  params: z.object({ maxVerifyAgeHours: z.number().positive().default(48) }),
  evaluate({ data, params, now }) {
    const ledger = ledgerOf(data.ledgerHealth);
    if (!ledger) return skip('No monthly ledger yet');
    if (!ledger.verifiedAt || !ledger.status) return skip('The ledger has not been verified yet');
    const hours = round((now.getTime() - Date.parse(ledger.verifiedAt)) / HOUR_MS, 1);
    if (hours > params.maxVerifyAgeHours)
      return fail(`Last ledger verification ${hours}h ago (max ${params.maxVerifyAgeHours}h)`);
    if (ledger.status === 'pass') return pass(`Ledger verified ${hours}h ago`);
    const since = ledger.failingSince ? ` since ${ledger.failingSince.slice(0, 10)}` : '';
    return fail(`${ledger.findings.length} ledger finding(s)${since}`, {
      evidence: ledger.findings.map((f, i) => ({
        kind: 'ledger-finding',
        id: `${f.check}:${f.month ?? '-'}:${f.dataset ?? '-'}:${String(i)}`,
        label: f.message,
      })),
    });
  },
});

const monthEvidence = (month: LedgerMonthHealth, label: string): Evidence => ({
  kind: 'ledger-month',
  id: month.month,
  label: `${month.month}: ${label}`,
});

/** Months that ended more than `days` ago and are still unsealed. */
const overdue = (months: readonly LedgerMonthHealth[], now: Date, days: number) =>
  months.filter(
    (m) => !m.sealed && now.getTime() - monthRange(m.month).end.getTime() > days * DAY_MS,
  );

/** Sealed months with later revisions, unsealed months whose last seal attempt failed. */
const needsReview = (months: readonly LedgerMonthHealth[]): Evidence[] =>
  months.flatMap((m) => {
    if (m.sealed && m.revisions > 0)
      return [monthEvidence(m, `${String(m.revisions)} revision entr(ies) after the seal`)];
    if (!m.sealed && m.lastSeal?.outcome === 'not-sealed')
      return [
        monthEvidence(m, `last seal attempt ${m.lastSeal.attemptedAt.slice(0, 10)} did not seal`),
      ];
    return [];
  });

export const ledgerMonthSealing = defineRule({
  meta: {
    id: 'OP-004',
    name: 'Ledger Month Sealing',
    category: 'operational',
    severity: 'medium',
    description:
      'Past ledger months that are not sealed, and sealed months changed afterwards (revisions)',
    remediation:
      'Check the Ledger Seal workflow; reconcile with pnpm ledger backfill --force and seal again (docs/DEPLOYMENT.md).',
  },
  requires: ['ledgerHealth'],
  params: z.object({
    maxUnsealedDays: z.number().int().positive().default(20),
    ignoreMonths: z.array(z.string()).default([]),
  }),
  evaluate({ data, params, now }) {
    const ledger = ledgerOf(data.ledgerHealth);
    if (!ledger || ledger.months.length === 0) return skip('No monthly ledger yet');
    const months = ledger.months.filter((m) => !params.ignoreMonths.includes(m.month));
    const late = overdue(months, now, params.maxUnsealedDays);
    if (late.length > 0)
      return fail(`${late.length} past month(s) not sealed`, {
        evidence: late.map((m) => monthEvidence(m, 'not sealed')),
      });
    const review = needsReview(months);
    if (review.length > 0)
      return warn(`${review.length} month(s) need review`, { evidence: review });
    const sealed = months.filter((m) => m.sealed).length;
    return pass(`${sealed} of ${months.length} month(s) sealed, none overdue`);
  },
});

export const operationalRules = [
  collectionFreshness,
  dataSourceCoverage,
  ledgerVerification,
  ledgerMonthSealing,
];
