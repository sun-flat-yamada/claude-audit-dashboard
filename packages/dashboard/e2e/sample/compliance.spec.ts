import type { Page } from '@playwright/test';
import type { DashboardView } from '@claude-audit/core/contracts';
import { openRoute, readData } from '../support/app';
import { expect, test } from '../support/test';

const FILTERS = [
  { label: 'All', status: null },
  { label: 'Fail', status: 'fail' },
  { label: 'Review', status: 'warning' },
  { label: 'Error', status: 'error' },
  { label: 'Skipped', status: 'skipped' },
  { label: 'Pass', status: 'pass' },
] as const;

/** One expandable row per rule (the chart tables are details elements too). */
const ruleRows = (page: Page) => page.locator('details').filter({ hasNotText: 'View as table' });

test.describe('compliance results (Phase A)', () => {
  test('filter buttons show the counts and narrow the list', async ({ page, request }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    const results = view.compliance.results;
    await openRoute(page, '/compliance');
    const filters = page.getByRole('group', { name: 'Filter by status' });
    const rows = ruleRows(page);
    for (const { label, status } of FILTERS) {
      const expected = status ? results.filter((r) => r.status === status) : results;
      const button = filters.getByRole('button', { name: new RegExp(`^${label} \\d+$`) });
      await expect(button).toHaveText(`${label} ${expected.length}`);
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      if (expected.length === 0) {
        await expect(page.getByText('No results with this status.')).toBeVisible();
        await expect(rows).toHaveCount(0);
      } else {
        await expect(rows).toHaveCount(expected.length);
        if (status) {
          for (const row of await rows.all())
            await expect(row.locator('summary')).toContainText(label);
        }
      }
    }
  });

  test('sorts failing rules first, then by severity', async ({ page }) => {
    await openRoute(page, '/compliance');
    const first = ruleRows(page).locator('summary').first();
    await expect(first).toContainText('Fail');
    await expect(first).toContainText('high');
    await expect(ruleRows(page).locator('summary').last()).toContainText('Pass');
  });

  test('a row expands to the remediation guidance and the evidence', async ({ page, request }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    const rule = view.compliance.results.find((r) => r.ruleId === 'AC-001');
    expect(rule?.remediation).toBeTruthy();
    expect(rule?.evidence.length).toBeGreaterThan(0);
    await openRoute(page, '/compliance');
    const row = ruleRows(page).filter({ hasText: 'AC-001 Inactive Members' });
    await expect(row.getByText(rule?.remediation ?? '')).toBeHidden();
    await row.locator('summary').click();
    await expect(row).toHaveAttribute('open', '');
    await expect(row.getByText(rule?.remediation ?? '')).toBeVisible();
    for (const evidence of rule?.evidence ?? []) {
      await expect(row.getByText(evidence.label, { exact: true })).toBeVisible();
    }
    await row.locator('summary').click();
    await expect(row.getByText(rule?.remediation ?? '')).toBeHidden();
  });

  test('the overview shows the same list and counts as the compliance screen', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    await openRoute(page, '/');
    await expect(
      page.getByRole('button', { name: `Fail ${view.compliance.failed}`, exact: true }),
    ).toBeVisible();
    await expect(ruleRows(page)).toHaveCount(view.compliance.results.length);
  });
});
