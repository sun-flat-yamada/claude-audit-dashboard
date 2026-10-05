import { describe, expect, it } from 'vitest';
import {
  MONTHLY_INDEX_PATH,
  checkDetailBundle,
  monthlyReportIndexSchema,
  monthlyReportPath,
  monthlyReportSchema,
} from '../../contracts/index.js';
import type { Cell, ReportDocument } from '../documents.js';
import { buildMonthlyReportView, mergeMonthlyIndex } from '../presenters/monthly-report-view.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const COST_COLUMNS = ['Date', 'Dimension', 'Key', 'Amount', 'List amount', 'Currency'];

const raw = (dimension: string, key: string | null, amount: number): Cell[] => [
  '2026-08-01',
  dimension,
  key,
  amount,
  amount * 1.15,
  'USD',
];

function document(rows: Cell[][], groupNames: string[], id = 'monthly-2026-08'): ReportDocument {
  const table = (title: string, names: string[]) => ({
    type: 'table' as const,
    title,
    columns: ['Name', 'Cost', 'Share of total'],
    rows: names.map((n): Cell[] => [n, '$0.00', '0.0%']),
  });
  return {
    id,
    kind: 'monthly',
    title: 'Monthly cost report',
    generatedAt: NOW.toISOString(),
    period: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
    sections: [
      table('Cost by product', ['chat']),
      table('Cost by model', ['claude-opus-5']),
      table('Cost by group', groupNames),
      { type: 'text', title: 'Notes', body: 'Group shares can exceed 100%.' },
      { type: 'table', title: 'Raw cost records', columns: COST_COLUMNS, rows },
    ],
  };
}

const overlapping = (): ReportDocument =>
  document(
    [
      raw('total', null, 100),
      raw('product', 'chat', 100),
      raw('model', 'claude-opus-5', 100),
      raw('group', 'g-eng', 70),
      raw('group', 'g-sales', 30),
      raw('group', 'g-both', 20),
      raw('group', null, 5),
    ],
    ['Engineering', 'Sales', 'Both', '(unattributed)'],
  );

describe('buildMonthlyReportView', () => {
  it('maps numbers from the raw records, names from the group table, total from the ungrouped value', () => {
    const view = buildMonthlyReportView(overlapping(), NOW);
    expect(view).not.toBeNull();
    expect(monthlyReportSchema.parse(view)).toEqual(view);
    expect(view?.id).toBe('monthly-2026-08');
    expect(view?.month).toBe('2026-08');
    expect(view?.status).toBe('ok');
    expect(view?.totalCost).toBe(100);
    expect(view?.byGroup.map((g) => [g.key, g.name, g.amount, g.share])).toEqual([
      ['g-eng', 'Engineering', 70, 70],
      ['g-sales', 'Sales', 30, 30],
      ['g-both', 'Both', 20, 20],
      ['(unattributed)', '(unattributed)', 5, 5],
    ]);
    expect(view?.byModel[0]).toMatchObject({ key: 'claude-opus-5', share: 100 });
    expect(view?.notes).toEqual(['Group shares can exceed 100%.']);
  });

  it('keeps group amounts as reported even when they add up to more than the total', () => {
    const view = buildMonthlyReportView(overlapping(), NOW);
    const sum = view?.byGroup.reduce((a, g) => a + g.amount, 0) ?? 0;
    expect(sum).toBeGreaterThan(view?.totalCost ?? 0);
  });

  it('falls back to keys when the group table does not line up', () => {
    const view = buildMonthlyReportView(
      document([raw('total', null, 10), raw('group', 'g-1', 10)], []),
      NOW,
    );
    expect(view?.byGroup[0]).toMatchObject({ key: 'g-1', name: 'g-1' });
  });

  it('marks a month without cost records unavailable with a reason', () => {
    const view = buildMonthlyReportView(document([], []), NOW);
    expect(view).toMatchObject({ status: 'unavailable', totalCost: null, byGroup: [] });
    expect(view?.reason).toMatch(/No cost records/);
  });

  it('returns null for other report kinds and unexpected ids', () => {
    expect(buildMonthlyReportView({ ...overlapping(), kind: 'weekly' }, NOW)).toBeNull();
    expect(buildMonthlyReportView({ ...overlapping(), id: 'monthly-latest' }, NOW)).toBeNull();
  });

  it('shares are 0 when the total is 0', () => {
    const view = buildMonthlyReportView(
      document([raw('total', null, 0), raw('group', 'g-1', 0)], ['G']),
      NOW,
    );
    expect(view?.byGroup[0]?.share).toBe(0);
  });
});

describe('mergeMonthlyIndex', () => {
  const view = (id: string) =>
    buildMonthlyReportView(document([raw('total', null, 5)], [], id), NOW);

  it('lists newest month first, one entry per id, and replaces a re-generated month', () => {
    const a = view('monthly-2026-06');
    const b = view('monthly-2026-08');
    const c = view('monthly-2026-07');
    if (!a || !b || !c) throw new Error('fixture');
    let index = mergeMonthlyIndex(null, a);
    index = mergeMonthlyIndex(index, b);
    index = mergeMonthlyIndex(index, c);
    index = mergeMonthlyIndex(index, { ...b, totalCost: 99 });
    expect(monthlyReportIndexSchema.parse(index)).toEqual(index);
    expect(index.reports.map((r) => r.id)).toEqual([
      'monthly-2026-08',
      'monthly-2026-07',
      'monthly-2026-06',
    ]);
    expect(index.reports[0]?.totalCost).toBe(99);
    expect(index.reports[0]?.path).toBe(monthlyReportPath('monthly-2026-08'));
  });
});

describe('monthly files in the detail bundle check', () => {
  const build = () => {
    const report = buildMonthlyReportView(overlapping(), NOW);
    if (!report) throw new Error('fixture');
    const manifest = {
      schemaVersion: 2,
      generatedAt: NOW.toISOString(),
      collectedAt: null,
      source: 'demo',
      maskPii: true,
      files: [],
    };
    return {
      'detail/index.json': JSON.stringify(manifest),
      [monthlyReportPath(report.id)]: JSON.stringify(report),
      [MONTHLY_INDEX_PATH]: JSON.stringify(mergeMonthlyIndex(null, report)),
    } as Record<string, string>;
  };

  it('accepts a consistent monthly directory next to the manifest', () => {
    expect(checkDetailBundle(build(), { requireDemo: true })).toEqual([]);
  });

  it('rejects a missing index, a missing file, an unlisted file and a mismatching id', () => {
    const files = build();
    const withoutIndex = { ...files };
    delete withoutIndex[MONTHLY_INDEX_PATH];
    expect(checkDetailBundle(withoutIndex).join()).toMatch(/monthly\/index.json/);

    const withoutFile = { ...files };
    delete withoutFile[monthlyReportPath('monthly-2026-08')];
    expect(checkDetailBundle(withoutFile).join()).toMatch(
      /listed in the monthly index but missing/,
    );

    expect(
      checkDetailBundle({ ...files, 'detail/monthly/monthly-2026-01.json': '{}' }).join(),
    ).toMatch(/not listed in the monthly index/);

    const other = JSON.parse(files[monthlyReportPath('monthly-2026-08')] ?? '{}') as object;
    expect(
      checkDetailBundle({
        ...files,
        [monthlyReportPath('monthly-2026-08')]: JSON.stringify({ ...other, month: '2026-07' }),
      }).join(),
    ).toMatch(/differs from the monthly index/);
  });

  it('rejects a real-looking e-mail address and a contract mismatch', () => {
    const files = build();
    const path = monthlyReportPath('monthly-2026-08');
    const report = JSON.parse(files[path] ?? '{}') as { notes: string[] };
    expect(
      checkDetailBundle({
        ...files,
        [path]: JSON.stringify({ ...report, notes: ['contact jane.doe@corp.test'] }),
      }).join(),
    ).toMatch(/non-example.com e-mail/);
    expect(checkDetailBundle({ ...files, [path]: '{"nope":1}' }).join()).toMatch(
      /does not match the monthly report contract/,
    );
  });
});
