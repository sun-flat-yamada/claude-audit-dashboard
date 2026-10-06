import type { DashboardView, DetailConfig } from '@claude-audit/core/contracts';
import { openRoute, readData } from '../support/app';
import { expect, test } from '../support/test';

/** The B4 datasets (Console Admin key). */
const B4 = [
  'consoleWorkspaces',
  'consoleApiKeys',
  'consoleUsage',
  'consoleCost',
  'claudeCodeActivity',
];
/** The AN-6 feature usage datasets (Analytics key). */
const FEATURES = ['skillUsage', 'connectorUsage', 'pluginUsage', 'chatProjectUsage'];
const OPTIONAL = [...B4, ...FEATURES];

// B4 and AN-6: the optional Console, Claude Code and feature usage datasets in Data coverage.
// Profiles: "optional-sources" (collected) and "optional-unavailable" (enabled, no Console key,
// feature usage denied with HTTP 403).
test.describe('B4 optional datasets in Data coverage', () => {
  const coverage = (page: import('@playwright/test').Page) =>
    page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: 'Data coverage' }),
    });

  test('every optional dataset has a row; with a key they are collected with their record counts', async ({
    page,
    request,
  }, info) => {
    test.skip(info.project.name !== 'optional-sources', 'runs on the optional-sources profile');
    const view = await readData<DashboardView>(request, 'dashboard.json');
    await openRoute(page, '/');
    for (const dataset of OPTIONAL) {
      const entry = view.coverage.find((c) => c.dataset === dataset);
      expect(entry?.status).toBe('ok');
      const row = coverage(page)
        .locator('tbody tr')
        .filter({ has: page.getByRole('cell', { name: dataset, exact: true }) });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Collected');
      await expect(row.getByRole('cell').nth(2)).toHaveText(
        new Intl.NumberFormat('en-US').format(entry?.count ?? 0),
      );
    }
    await expect(coverage(page).locator('tbody tr')).toHaveCount(view.coverage.length);
  });

  test('without a Console key they show Unavailable with the reason; the other datasets are unchanged', async ({
    page,
    request,
  }, info) => {
    test.skip(
      info.project.name !== 'optional-unavailable',
      'runs on the optional-unavailable profile',
    );
    const view = await readData<DashboardView>(request, 'dashboard.json');
    await openRoute(page, '/');
    for (const dataset of OPTIONAL) {
      const row = coverage(page)
        .locator('tbody tr')
        .filter({ has: page.getByRole('cell', { name: dataset, exact: true }) });
      await expect(row).toContainText('Unavailable');
      await expect(row).toContainText(
        B4.includes(dataset) ? 'ANTHROPIC_CONSOLE_ADMIN_API_KEY' : 'read:analytics',
      );
      await expect(row.getByRole('cell').nth(2)).toHaveText('—');
    }
    const collected = view.coverage.filter((c) => !OPTIONAL.includes(c.dataset));
    await expect(coverage(page).locator('tbody tr', { hasText: 'Collected' })).toHaveCount(
      collected.length,
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the configuration view lists the optional datasets as data sources', async ({
    page,
    request,
  }) => {
    const config = await readData<DetailConfig>(request, 'detail/config.json');
    await openRoute(page, '/config');
    const sources = page.getByRole('table', { name: 'Data sources', exact: true });
    await expect(sources.locator('tbody tr')).toHaveCount(config.sources.datasets.length);
    for (const dataset of OPTIONAL) {
      await expect(sources.getByText(dataset, { exact: true })).toBeVisible();
    }
  });
});
