import type { DashboardView } from '@claude-audit/core/contracts';
import { openRoute, readData } from '../support/app';
import { expect, test } from '../support/test';

test.describe('first load (Phase A)', () => {
  test('shows the title, the Demo badge, the score and the KPI tiles', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    await openRoute(page, '/');
    await expect(page).toHaveTitle('Claude Audit Dashboard');
    await expect(page.getByRole('heading', { level: 1, name: view.title })).toBeVisible();
    await expect(page.getByText('Demo data (synthetic tenant)')).toBeVisible();

    const score = view.kpis.find((k) => k.id === 'score');
    expect(score?.value).not.toBeNull();
    await expect(page.getByText(score?.label ?? '', { exact: true })).toBeVisible();
    // The score figure (a span): the trend chart's table view repeats the score of each point.
    await expect(
      page.locator('span').getByText(String(score?.value), { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('/ 100')).toBeVisible();
    const { failed, warnings, errors, skipped } = view.compliance;
    await expect(
      page.getByText(
        `${failed} failed · ${warnings} to review · ${errors} errors · ${skipped} skipped`,
      ),
    ).toBeVisible();
    for (const kpi of view.kpis.filter((k) => k.id !== 'score')) {
      await expect(page.getByRole('main').getByText(kpi.label, { exact: true })).toBeVisible();
    }
  });

  test('renders every section with its charts', async ({ page, request }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    await openRoute(page, '/');
    for (const name of [
      'Insights',
      'Compliance checks',
      'Failing rules by category',
      'Daily cost',
      'Daily tokens',
      'Spend by product',
      'Spend by model',
      'Spend by group',
      'Active users',
      'Activity feed',
      'Data coverage',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    // Line charts: the score trend (the sample carries three time points, F-015), cost, tokens
    // and active users.
    expect(view.compliance.history).toHaveLength(3);
    const figures = page.locator('figure');
    await expect(figures).toHaveCount(4);
    for (const figure of await figures.all()) {
      await expect(figure.locator('svg.recharts-surface')).toBeVisible();
      await expect(figure.locator('path.recharts-curve').first()).toBeAttached();
    }
  });

  test('every chart has a "View as table" twin with the exact values', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    await openRoute(page, '/');
    const expectedRows = [
      view.compliance.history.length,
      view.usage?.daily.length,
      view.usage?.daily.length,
      view.adoption?.daily.length,
    ];
    const figures = await page.locator('figure').all();
    expect(figures).toHaveLength(expectedRows.length);
    for (const [index, figure] of figures.entries()) {
      const table = figure.getByRole('table');
      await expect(table).toBeHidden();
      await figure.getByText('View as table').click();
      await expect(table).toBeVisible();
      await expect(table.locator('tbody tr')).toHaveCount(expectedRows[index] ?? -1);
      await expect(table.getByRole('columnheader').first()).toHaveText('Date');
    }
  });

  test('lists active users by product with a weekly sparkline per product (AN-2)', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    const products = view.adoption?.byProduct ?? [];
    expect(products.length).toBeGreaterThan(0);
    await openRoute(page, '/');
    const card = page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: 'Active users' }),
    });
    await expect(card.getByRole('heading', { level: 3, name: 'By product' })).toBeVisible();
    for (const product of products) {
      const row = card.getByRole('row').filter({
        has: page.getByRole('rowheader', { name: product.label, exact: true }),
      });
      await expect(row.getByRole('cell').nth(1)).toHaveText(String(product.wau));
      await expect(row.getByRole('img', { name: /weekly active users/ })).toBeVisible();
    }
  });

  test('shows product engagement and the Claude Code accept rate per tool (AN-3)', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    const engagement = view.engagement;
    expect(engagement?.products.length).toBeGreaterThan(0);
    await openRoute(page, '/');
    const card = page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: /^Product engagement \(\d+ days\)$/ }),
    });
    await expect(card).toBeVisible();
    for (const product of engagement?.products ?? []) {
      const row = card.getByRole('row').filter({
        has: page.getByRole('rowheader', { name: product.label, exact: true }),
      });
      await expect(row.getByRole('cell').first()).toHaveText(
        `${product.activeMembers.toLocaleString('en-US')} / ${String(engagement?.members)}`,
      );
    }
    const code = engagement?.claudeCode;
    expect(code?.acceptRate).not.toBeNull();
    await expect(card.getByRole('heading', { level: 3, name: 'Claude Code' })).toBeVisible();
    await expect(
      card.locator('dl > div', { hasText: 'Suggestion accept rate' }).locator('dd'),
    ).toHaveText(`${code?.acceptRate?.toFixed(1) ?? ''}%`);
    const twin = card.locator('details table');
    await expect(twin).toBeHidden();
    await card.getByText('View as table').click();
    await expect(twin.locator('tbody tr')).toHaveCount(code?.tools.length ?? -1);
  });

  test('lists every dataset in Data coverage; the default profile has no optional datasets', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    await openRoute(page, '/');
    const coverage = page.locator('section', {
      has: page.getByRole('heading', { name: 'Data coverage' }),
    });
    await expect(coverage.locator('tbody tr')).toHaveCount(view.coverage.length);
    for (const entry of view.coverage) {
      await expect(coverage.getByRole('cell', { name: entry.dataset, exact: true })).toBeVisible();
    }
    for (const optional of [
      'consoleWorkspaces',
      'consoleApiKeys',
      'consoleUsage',
      'consoleCost',
      'claudeCodeActivity',
    ]) {
      await expect(coverage.getByRole('cell', { name: optional, exact: true })).toHaveCount(0);
    }
  });
});
