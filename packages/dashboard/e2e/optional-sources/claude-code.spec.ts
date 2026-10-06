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

// AN-4: the Claude Code page with the optional source collected ("optional-sources") and enabled
// without a Console key ("optional-unavailable").
test.describe('Claude Code page with the optional source', () => {
  test('shows the aggregate figures, daily charts, terminals and models', async ({
    page,
    request,
  }, info) => {
    test.skip(info.project.name !== 'optional-sources', 'runs on the optional-sources profile');
    const view = await readData<DashboardView>(request, 'dashboard.json');
    const cc = view.claudeCode;
    expect(cc).toBeDefined();
    if (!cc) return;
    await openRoute(page, '/claude-code');
    const tile = (label: string) =>
      page
        .getByRole('term')
        .filter({ hasText: new RegExp(`^${label}$`) })
        .locator('xpath=..');
    await expect(tile('Active users')).toContainText(integer.format(cc.users));
    await expect(tile('Sessions')).toContainText(integer.format(cc.totals.sessions));
    await expect(tile('Lines added')).toContainText(integer.format(cc.totals.addedLines));
    await expect(tile('Suggestion accept rate')).toContainText(
      `${(cc.totals.acceptRate ?? 0).toFixed(1)}%`,
    );
    for (const title of [
      'Daily users and sessions',
      'Lines of code per day',
      'Suggestion accept rate per day',
      'Sessions by terminal',
      'Tokens and estimated cost by model',
    ])
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
    const models = page.getByRole('table', { name: 'Tokens and estimated cost by model' });
    await expect(models.locator('tbody tr')).toHaveCount(cc.byModel.length);
    // Aggregates only: no actor of the synthetic tenant is on the page.
    await expect(page.getByText(/@example\.com|ci-code-review-bot/)).toHaveCount(0);
  });

  test('the Overview engagement panel links to the page', async ({ page }, info) => {
    test.skip(info.project.name !== 'optional-sources', 'runs on the optional-sources profile');
    await openRoute(page, '/');
    await page.getByRole('link', { name: /Claude Code page/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Claude Code' })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Sessions by terminal' }),
    ).toBeVisible();
  });

  test('without a Console key it names the reason and the enabling steps', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== 'optional-unavailable',
      'runs on the optional-unavailable profile',
    );
    await openRoute(page, '/claude-code');
    await expect(page.getByRole('status')).toContainText('ANTHROPIC_CONSOLE_ADMIN_API_KEY');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Claude Code activity is not collected' }),
    ).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe ${theme}: /claude-code`, async ({ page }, testInfo) => {
      await presetTheme(page, theme);
      await openRoute(page, '/claude-code');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const violations = await scan(page, testInfo, `${theme}_claude-code`);
      expect(blocking(violations), 'critical / serious axe violations').toEqual([]);
    });
  }

  test('390px: no horizontal page scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRoute(page, '/claude-code');
    expect(await pageScrollsHorizontally(page)).toBe(false);
  });
});
