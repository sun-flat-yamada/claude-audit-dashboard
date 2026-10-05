import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMPLIANCE_EXPORT_COLUMNS,
  type DashboardCheckResult,
  type DashboardView,
} from '@claude-audit/core/contracts';
import { openRoute, readData } from '../support/app';
import { downloadText, parseCsv } from '../support/csv';
import { expect, test } from '../support/test';

const EXTRA_COLUMNS = ['Category', 'Remediation', 'Evidence'];
const STATUS = ['fail', 'error', 'warning', 'skipped', 'pass'];
const SEVERITY = ['critical', 'high', 'medium', 'low', 'info'];

/** Failing first, then severity, then rule id: the order of the screen. */
const sorted = (results: DashboardCheckResult[]) =>
  [...results].sort(
    (a, b) =>
      STATUS.indexOf(a.status) - STATUS.indexOf(b.status) ||
      SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity) ||
      a.ruleId.localeCompare(b.ruleId),
  );

const expectedRow = (r: DashboardCheckResult) => [
  r.ruleId,
  r.ruleName,
  r.severity,
  r.status,
  r.message,
  r.category,
  r.remediation ?? '',
  r.evidence.map((e) => e.label).join('; '),
];

test.describe('F-003 compliance export', () => {
  test('"Export all CSV" downloads every result with the shared columns first', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    await openRoute(page, '/compliance');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export all CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('compliance-results-20260929.csv');
    const text = await downloadText(download);
    expect(text.endsWith('\r\n')).toBe(true);
    const [header, ...rows] = parseCsv(text);
    expect(header).toEqual([...COMPLIANCE_EXPORT_COLUMNS, ...EXTRA_COLUMNS]);
    expect(rows).toEqual(sorted(view.compliance.results).map(expectedRow));
  });

  test('matches the collector compliance report of the sample on the shared columns', async ({
    page,
  }) => {
    const report = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          '..',
          '..',
          '..',
          '..',
          'data',
          'sample',
          'compliance-report.json',
        ),
        'utf-8',
      ),
    ) as { results: { ruleId: string; ruleName: string; severity: string; message: string }[] };
    await openRoute(page, '/compliance');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export all CSV' }).click(),
    ]);
    const [, ...rows] = parseCsv(await downloadText(download));
    const byRule = new Map(rows.map((r) => [r[0], r]));
    expect(byRule.size).toBe(report.results.length);
    for (const r of report.results) {
      const row = byRule.get(r.ruleId);
      expect([row?.[1], row?.[2], row?.[4]]).toEqual([r.ruleName, r.severity, r.message]);
    }
  });

  test('a filtered export holds only the visible rows and names the filter', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    await openRoute(page, '/compliance');
    await page
      .getByRole('group', { name: 'Filter by status' })
      .getByRole('button', { name: /^Fail / })
      .click();
    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV (Fail)' }).click(),
    ]);
    expect(csv.suggestedFilename()).toBe('compliance-results-20260929-fail.csv');
    const [, ...rows] = parseCsv(await downloadText(csv));
    expect(rows).toEqual(
      sorted(view.compliance.results.filter((r) => r.status === 'fail')).map(expectedRow),
    );

    const [json] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export JSON (Fail)' }).click(),
    ]);
    expect(json.suggestedFilename()).toBe('compliance-results-20260929-fail.json');
    const parsed = JSON.parse(await downloadText(json)) as {
      filter: string;
      count: number;
      results: { ruleId: string }[];
    };
    expect(parsed.filter).toBe('fail');
    expect(parsed.count).toBe(view.compliance.failed);
    expect(parsed.results.map((r) => r.ruleId)).toEqual(
      sorted(view.compliance.results.filter((r) => r.status === 'fail')).map((r) => r.ruleId),
    );
  });

  test('"Export all JSON" ignores the filter; an empty filter disables the filtered buttons', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    await openRoute(page, '/compliance');
    await page
      .getByRole('group', { name: 'Filter by status' })
      .getByRole('button', { name: /^Error / })
      .click();
    await expect(page.getByRole('button', { name: 'Export CSV (Error)' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Export JSON (Error)' })).toBeDisabled();
    const [json] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export all JSON' }).click(),
    ]);
    expect(json.suggestedFilename()).toBe('compliance-results-20260929.json');
    const parsed = JSON.parse(await downloadText(json)) as { filter: string; count: number };
    expect(parsed).toMatchObject({ filter: 'all', count: view.compliance.results.length });
  });

  test('cells that start like a formula are neutralised', async ({ page, request }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    await openRoute(page, '/compliance');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export all CSV' }).click(),
    ]);
    const [, ...rows] = parseCsv(await downloadText(download));
    expect(view.compliance.results.length).toBe(rows.length);
    for (const cell of rows.flat()) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
  });
});
