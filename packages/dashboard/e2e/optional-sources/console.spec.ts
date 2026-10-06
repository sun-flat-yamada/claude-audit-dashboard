import type { DashboardView } from '@claude-audit/core/contracts';
import {
  blocking,
  openRoute,
  pageScrollsHorizontally,
  presetTheme,
  readData,
  scan,
} from '../support/app';
import { expect, test } from '../support/test';

const integer = new Intl.NumberFormat('en-US');

// AN-5: the Console API page with the optional source collected ("optional-sources") and enabled
// without a Console key ("optional-unavailable").
test.describe('Console API page with the optional source', () => {
  test('shows the spend, cache share, breakdowns and token types', async ({
    page,
    request,
  }, info) => {
    test.skip(info.project.name !== 'optional-sources', 'runs on the optional-sources profile');
    const view = await readData<DashboardView>(request, 'dashboard.json');
    const c = view.console;
    expect(c).toBeDefined();
    if (!c) return;
    await openRoute(page, '/console');
    const tile = (label: string) =>
      page
        .getByRole('term')
        .filter({ hasText: new RegExp(`^${label}$`) })
        .locator('xpath=..');
    await expect(tile('Cache read share')).toContainText(`${(c.cacheReadShare ?? 0).toFixed(1)}%`);
    await expect(tile('Active workspaces')).toContainText(
      integer.format(c.workspaces?.active ?? 0),
    );
    await expect(tile('Web search requests')).toContainText(integer.format(c.webSearchRequests));
    for (const title of [
      'Daily spend',
      'Daily tokens by type',
      'Spend by model',
      'Spend by workspace',
      'Spend by cost type',
      'Tokens by type',
    ])
      await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
    const workspaces = page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: 'Spend by workspace' }),
    });
    await expect(workspaces.getByText('Default workspace').first()).toBeVisible();
    await expect(workspaces.getByText('Example Production').first()).toBeVisible();
    const tokens = page.getByRole('table', { name: 'Tokens by type' });
    await expect(tokens.locator('tbody tr')).toHaveCount(4);
    // Aggregates only: no key name, key id or creator of the synthetic tenant is on the page.
    await expect(page.getByText(/production-backend|apikey_|user_demo/)).toHaveCount(0);
  });

  test('without a Console key it names the reason and the enabling steps', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== 'optional-unavailable',
      'runs on the optional-unavailable profile',
    );
    await openRoute(page, '/console');
    await expect(page.getByRole('status')).toContainText('ANTHROPIC_CONSOLE_ADMIN_API_KEY');
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'Console API usage and cost are not collected',
      }),
    ).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe ${theme}: /console`, async ({ page }, testInfo) => {
      await presetTheme(page, theme);
      await openRoute(page, '/console');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const violations = await scan(page, testInfo, `${theme}_console`);
      expect(blocking(violations), 'critical / serious axe violations').toEqual([]);
    });
  }

  test('390px: no horizontal page scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRoute(page, '/console');
    expect(await pageScrollsHorizontally(page)).toBe(false);
  });
});
