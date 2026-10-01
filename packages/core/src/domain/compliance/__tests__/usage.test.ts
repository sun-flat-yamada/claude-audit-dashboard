import { describe, expect, it } from 'vitest';
import { NOW, costRow, dayString, snapshot, usageRow } from '../../../__tests__/fixtures.js';
import { costBudget, spendNearLimit, unlimitedSpend, usageSpike } from '../rules/usage.js';
import { evaluate } from './helpers.js';

const history = (latest: number) => [
  ...Array.from({ length: 7 }, (_, i) => usageRow(dayString(i + 2), 10_000)),
  usageRow(dayString(1), latest),
  usageRow(dayString(0), 999_999_999), // today: incomplete, ignored
];

describe('UA-001 Usage Spike Detection', () => {
  it('compares the latest complete day with the trailing average', () => {
    expect(evaluate(usageSpike, snapshot({ usage: history(40_000) })).status).toBe('fail');
    expect(evaluate(usageSpike, snapshot({ usage: history(20_000) })).status).toBe('pass');
  });

  it('ignores days after data_refreshed_at and grouped rows', () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => usageRow(dayString(i + 2), 10_000)),
      usageRow(dayString(2), 10_000_000, { dimension: 'model', key: 'm' }),
      usageRow(dayString(1), 90_000), // spike on a day that is still being refreshed
    ];
    expect(evaluate(usageSpike, snapshot({ usage: rows })).status).toBe('fail');
    const asOf = `${dayString(1)}T06:00:00.000Z`;
    const result = evaluate(
      usageSpike,
      snapshot({ usage: rows }, { usage: { status: 'ok', asOf } }),
    );
    expect(result).toMatchObject({
      status: 'pass',
      details: { day: dayString(2), latest: 10_000 },
    });
  });

  it('skips without enough history', () => {
    expect(evaluate(usageSpike, snapshot({ usage: [usageRow(dayString(1), 5)] })).status).toBe(
      'skipped',
    );
  });
});

describe('UA-002 Cost Budget Threshold', () => {
  const september = (amount: number) => [
    costRow('2026-09-10', amount),
    costRow('2026-08-31', 99_999),
  ];

  it('fails above the budget, warns on the forecast and passes otherwise', () => {
    expect(evaluate(costBudget, snapshot({ cost: september(12_000) })).status).toBe('fail');
    expect(evaluate(costBudget, snapshot({ cost: september(9_900) })).status).toBe('warning');
    expect(evaluate(costBudget, snapshot({ cost: september(1_000) })).status).toBe('pass');
  });

  it('only counts rows in the configured currency', () => {
    const rows = [costRow('2026-09-10', 50_000, { currency: 'EUR' })];
    expect(evaluate(costBudget, snapshot({ cost: rows })).status).toBe('pass');
  });
});

describe('UA-003 / UA-004 spend limits', () => {
  const row = (userId: string, limit: number | null, spent: number, period = 'monthly') => ({
    userId,
    email: `${userId}@example.com`,
    period,
    limit,
    spent,
    source: 'organization',
    currency: 'USD',
  });

  it('flags members unlimited in every period', () => {
    const result = evaluate(
      unlimitedSpend,
      snapshot({
        spendLimits: [
          row('a', null, 0),
          row('b', null, 0),
          row('b', 100, 0, 'daily'),
          row('c', 500, 10),
        ],
      }),
    );
    expect(result.evidence.map((e) => e.id)).toEqual(['a']);
    expect(evaluate(unlimitedSpend, snapshot({ spendLimits: [] })).status).toBe('skipped');
  });

  it('warns for members at the threshold share of their limit', () => {
    const result = evaluate(
      spendNearLimit,
      snapshot({ spendLimits: [row('a', 100, 95), row('b', 100, 10), row('c', null, 1e6)] }),
    );
    expect(result).toMatchObject({ status: 'warning', evidence: [{ id: 'a' }] });
  });
});

describe('fixtures', () => {
  it('uses a fixed clock', () => {
    expect(NOW.toISOString()).toBe('2026-09-30T12:00:00.000Z');
  });
});
