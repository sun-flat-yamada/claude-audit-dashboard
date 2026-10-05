import type {
  DetailAlerts,
  DetailArchive,
  DetailManifest,
  MonthlyReport,
  MonthlyReportIndex,
} from '@claude-audit/core/contracts';
import type { Page } from '@playwright/test';
import { openRoute, readData } from '../support/app';
import { expect, test } from '../support/test';

const bodyRows = (page: Page, name: string) =>
  page.getByRole('table', { name, exact: true }).locator('tbody tr');
const money = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

test.describe('F-008 alert history and acknowledgements', () => {
  test('totals and rows come from the published history; acknowledgement is read-only', async ({
    page,
    request,
  }) => {
    const data = await readData<DetailAlerts>(request, 'detail/alerts.json');
    await openRoute(page, '/alerts');
    const totals = page.getByRole('term').filter({ hasText: 'Alerts sent' });
    await expect(totals).toBeVisible();
    await expect(page.locator('dd').nth(0)).toHaveText(String(data.totals.alerts));
    await expect(page.locator('dd').nth(1)).toHaveText(String(data.totals.acknowledged));
    await expect(page.locator('dd').nth(2)).toHaveText(String(data.totals.unacknowledged));
    await expect(bodyRows(page, 'Alert history')).toHaveCount(data.alerts.length);
    await expect(
      page.getByRole('heading', { level: 2, name: 'How to acknowledge an alert' }),
    ).toBeVisible();
    await expect(page.getByText('This page is read-only.')).toBeVisible();
    // Nothing on the page acknowledges an alert (the filter chips are named "Acknowledged ..." / "Unacknowledged ...").
    await expect(page.getByRole('button', { name: /^Acknowledge\b/ })).toHaveCount(0);
  });

  test('acknowledgement filter and search narrow the history', async ({ page, request }) => {
    const data = await readData<DetailAlerts>(request, 'detail/alerts.json');
    await openRoute(page, '/alerts');
    const rows = bodyRows(page, 'Alert history');
    await page.getByRole('button', { name: /^Acknowledged \d+$/ }).click();
    await expect(rows).toHaveCount(data.totals.acknowledged);
    for (const row of await rows.all()) await expect(row).toContainText('by ');
    await page.getByRole('button', { name: /^Unacknowledged \d+$/ }).click();
    await expect(rows).toHaveCount(data.totals.unacknowledged);
    await page.getByRole('button', { name: /^All \d+$/ }).click();

    const ruleId = data.alerts[0]?.findings[0]?.ruleId ?? '';
    const hits = data.alerts.filter(
      (a) => a.findings.some((f) => f.ruleId === ruleId) || a.title.includes(ruleId),
    );
    await page.getByRole('searchbox', { name: 'Search alerts' }).fill(ruleId);
    await expect(rows).toHaveCount(hits.length);
    await page.getByRole('searchbox', { name: 'Search alerts' }).fill('no-such-alert');
    await expect(page.getByText('No alerts match the current search and filter.')).toBeVisible();
  });
});

test.describe('F-009 monthly cost report', () => {
  test('opens the newest month with chargeback, model and product tables', async ({
    page,
    request,
  }) => {
    const index = await readData<MonthlyReportIndex>(request, 'detail/monthly/index.json');
    const newest = index.reports[0];
    const report = await readData<MonthlyReport>(request, `detail/monthly/${newest?.id}.json`);
    await openRoute(page, '/reports/monthly');
    await expect(page.getByLabel('Month')).toHaveValue(newest?.id ?? '');
    await expect(page.getByText(money(report.totalCost ?? 0)).first()).toBeVisible();
    await expect(bodyRows(page, 'Chargeback by RBAC group')).toHaveCount(report.byGroup.length);
    await expect(bodyRows(page, 'Cost by model')).toHaveCount(report.byModel.length);
    await expect(bodyRows(page, 'Cost by product')).toHaveCount(report.byProduct.length);
    await expect(page.getByText('Groups overlap')).toBeVisible();
    for (const group of report.byGroup) {
      await expect(
        bodyRows(page, 'Chargeback by RBAC group').filter({ hasText: group.name }),
      ).toContainText(money(group.amount));
    }
  });

  test('switching the month changes the report and the URL; deep links open a month', async ({
    page,
    request,
  }) => {
    const index = await readData<MonthlyReportIndex>(request, 'detail/monthly/index.json');
    const older = index.reports[2];
    const report = await readData<MonthlyReport>(request, `detail/monthly/${older?.id}.json`);
    await openRoute(page, '/reports/monthly');
    await page.getByLabel('Month').selectOption(older?.id ?? '');
    await expect(page).toHaveURL(new RegExp(`#/reports/monthly/${older?.id}$`));
    await expect(page.getByText(money(report.totalCost ?? 0)).first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Month')).toHaveValue(older?.id ?? '');
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).locator('[aria-current="page"]'),
    ).toHaveText('Monthly report');
  });

  test('search narrows the tables; an unknown month says so', async ({ page }) => {
    await openRoute(page, '/reports/monthly');
    await page
      .getByRole('searchbox', { name: 'Search groups, models and products' })
      .fill('engineering');
    await expect(bodyRows(page, 'Chargeback by RBAC group')).toHaveCount(1);
    await expect(page.getByText('No rows match “engineering”.').first()).toBeVisible();
    await openRoute(page, '/reports/monthly/monthly-1999-01');
    await expect(
      page.getByText('There is no monthly report “monthly-1999-01” in the published data.'),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Show the newest month' }).click();
    await expect(page.getByLabel('Month')).not.toHaveValue('monthly-1999-01');
  });
});

test.describe('F-013 archive inventory and B3 size', () => {
  test('shows the snapshot count and compressed size from the inventory, per year too', async ({
    page,
    request,
  }) => {
    const data = await readData<DetailArchive>(request, 'detail/archive.json');
    await openRoute(page, '/archive');
    const totals = page.getByRole('main').locator('dl');
    const sizeText = `${(data.totals.bytes / 1024 ** 2).toFixed(1)} MB`;
    await expect(totals).toContainText(`Archived snapshots${data.totals.snapshots}`);
    await expect(totals).toContainText(`Compressed size${sizeText}`);
    await expect(totals).toContainText(`Years covered${data.totals.years}`);
    await expect(totals).toContainText(`Retention before archiving${data.snapshotDays} days`);
    const rows = bodyRows(page, 'Archive by year');
    await expect(rows).toHaveCount(data.years.length);
    // The per-year figures add up to the totals the page prints (what `pnpm size` / `pnpm archive` count).
    expect(data.years.reduce((sum, y) => sum + y.snapshots, 0)).toBe(data.totals.snapshots);
    expect(data.years.reduce((sum, y) => sum + y.bytes, 0)).toBe(data.totals.bytes);
    for (const year of data.years) {
      await expect(rows.filter({ hasText: year.year })).toContainText(String(year.snapshots));
    }
    await expect(
      page.getByText(`${data.ignoredEntries} unrecognized entry was ignored (not named here).`),
    ).toBeVisible();
  });

  test('the year search narrows the table', async ({ page }) => {
    await openRoute(page, '/archive');
    await page.getByRole('searchbox', { name: 'Search years' }).fill('2024');
    await expect(bodyRows(page, 'Archive by year')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search years' }).fill('1999');
    await expect(page.getByText('No years match the current search.')).toBeVisible();
  });

  test('the manifest lists the archive file', async ({ request }) => {
    const manifest = await readData<DetailManifest>(request, 'detail/index.json');
    expect(manifest.files.some((f) => f.kind === 'archive' && f.status === 'ok')).toBe(true);
  });
});
