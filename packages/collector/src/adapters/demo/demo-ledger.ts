import type { LedgerHealth } from '@claude-audit/core';
import { addDays, monthKey, monthRange, previousMonth } from '@claude-audit/core';

/**
 * Deterministic synthetic `ledgerHealth` row (#160 U6): verified six hours ago without findings,
 * the two previous months sealed on the 10th of the following month, the current month open.
 */
export function demoLedgerHealth(now: Date): LedgerHealth[] {
  const current = monthKey(now);
  const last = previousMonth(now);
  const beforeLast = previousMonth(monthRange(last).start);
  const sealedMonth = (month: string) => ({
    month,
    sealed: true,
    sealedAt: addDays(monthRange(month).end, 9).toISOString(),
    revisions: 0,
    lastSeal: {
      attemptedAt: addDays(monthRange(month).end, 9).toISOString(),
      outcome: 'sealed' as const,
    },
  });
  return [
    {
      verifiedAt: new Date(now.getTime() - 6 * 3_600_000).toISOString(),
      status: 'pass',
      failingSince: null,
      findings: [],
      lastRecordedAt: new Date(now.getTime() - 6 * 3_600_000).toISOString(),
      months: [
        sealedMonth(beforeLast),
        sealedMonth(last),
        { month: current, sealed: false, sealedAt: null, revisions: 0, lastSeal: null },
      ],
    },
  ];
}
