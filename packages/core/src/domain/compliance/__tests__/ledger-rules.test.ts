import { describe, expect, it } from 'vitest';
import { NOW, snapshot } from '../../../__tests__/fixtures.js';
import type { LedgerHealth, LedgerMonthHealth } from '../../ledger/health.js';
import { ledgerMonthSealing, ledgerVerification } from '../rules/operational.js';
import { evaluate } from './helpers.js';

const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const month = (name: string, overrides: Partial<LedgerMonthHealth> = {}): LedgerMonthHealth => ({
  month: name,
  sealed: false,
  sealedAt: null,
  revisions: 0,
  lastSeal: null,
  ...overrides,
});

const health = (overrides: Partial<LedgerHealth> = {}): LedgerHealth => ({
  verifiedAt: hoursAgo(5),
  status: 'pass',
  failingSince: null,
  findings: [],
  lastRecordedAt: hoursAgo(6),
  months: [
    month('2026-08', { sealed: true, sealedAt: '2026-09-10T04:00:00.000Z' }),
    month('2026-09'),
  ],
  ...overrides,
});

const withHealth = (rows: LedgerHealth[]) => snapshot({ ledgerHealth: rows });

describe('OP-003 Ledger Verification', () => {
  it('passes after a recent verification without findings', () => {
    const result = evaluate(ledgerVerification, withHealth([health()]));
    expect(result).toMatchObject({ status: 'pass', message: 'Ledger verified 5h ago' });
  });

  it('fails with one evidence entry per finding', () => {
    const result = evaluate(
      ledgerVerification,
      withHealth([
        health({
          status: 'fail',
          failingSince: '2026-09-27T05:30:00.000Z',
          findings: [
            {
              check: 'gap',
              month: '2026-09',
              dataset: 'usage',
              message: 'usage 2026-09: 1 day(s) without rows: 2026-09-12',
              dates: ['2026-09-12'],
            },
            {
              check: 'digest',
              month: '2026-08',
              dataset: 'cost',
              message: '2026-08 cost: content hash differs from MANIFEST.json',
            },
          ],
        }),
      ]),
    );
    expect(result.status).toBe('fail');
    expect(result.message).toBe('2 ledger finding(s) since 2026-09-27');
    expect(result.evidence.map((e) => e.label)).toEqual([
      'usage 2026-09: 1 day(s) without rows: 2026-09-12',
      '2026-08 cost: content hash differs from MANIFEST.json',
    ]);
    expect(result.remediation).toMatch(/ledger backfill/);
  });

  it('fails when the last verification is too old', () => {
    const result = evaluate(ledgerVerification, withHealth([health({ verifiedAt: hoursAgo(49) })]));
    expect(result.status).toBe('fail');
    expect(
      evaluate(ledgerVerification, withHealth([health({ verifiedAt: hoursAgo(49) })]), {
        maxVerifyAgeHours: 72,
      }).status,
    ).toBe('pass');
  });

  it('is skipped without a ledger, without a verification, or without the dataset', () => {
    expect(evaluate(ledgerVerification, withHealth([])).message).toBe('No monthly ledger yet');
    expect(
      evaluate(ledgerVerification, withHealth([health({ verifiedAt: null, status: null })])).status,
    ).toBe('skipped');
    const missing = snapshot({}, { ledgerHealth: { status: 'error', reason: 'x' } });
    expect(evaluate(ledgerVerification, missing).status).toBe('skipped');
  });
});

describe('OP-004 Ledger Month Sealing', () => {
  it('passes while no past month is overdue', () => {
    expect(evaluate(ledgerMonthSealing, withHealth([health()]))).toMatchObject({
      status: 'pass',
      message: '1 of 2 month(s) sealed, none overdue',
    });
  });

  it('fails for a month that ended more than maxUnsealedDays ago and is not sealed', () => {
    const rows = [health({ months: [month('2026-07'), month('2026-08'), month('2026-09')] })];
    const result = evaluate(ledgerMonthSealing, withHealth(rows));
    // 2026-07 ended 61 days before NOW, 2026-08 30 days before.
    expect(result.status).toBe('fail');
    expect(result.evidence.map((e) => e.id)).toEqual(['2026-07', '2026-08']);
    expect(
      evaluate(ledgerMonthSealing, withHealth(rows), { maxUnsealedDays: 45 }).evidence,
    ).toHaveLength(1);
    expect(
      evaluate(ledgerMonthSealing, withHealth(rows), { ignoreMonths: ['2026-07', '2026-08'] })
        .status,
    ).toBe('pass');
  });

  it('warns about revisions after the seal and failed seal attempts', () => {
    const rows = [
      health({
        months: [
          month('2026-08', { sealed: true, revisions: 3 }),
          month('2026-09', {
            lastSeal: { attemptedAt: '2026-09-29T04:00:00.000Z', outcome: 'not-sealed' },
          }),
        ],
      }),
    ];
    const result = evaluate(ledgerMonthSealing, withHealth(rows));
    expect(result.status).toBe('warning');
    expect(result.evidence.map((e) => e.label)).toEqual([
      '2026-08: 3 revision entr(ies) after the seal',
      '2026-09: last seal attempt 2026-09-29 did not seal',
    ]);
  });

  it('is skipped without ledger months', () => {
    expect(evaluate(ledgerMonthSealing, withHealth([])).status).toBe('skipped');
    expect(evaluate(ledgerMonthSealing, withHealth([health({ months: [] })])).status).toBe(
      'skipped',
    );
  });
});
