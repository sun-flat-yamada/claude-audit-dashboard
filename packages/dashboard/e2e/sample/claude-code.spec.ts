import type { DashboardView } from '@claude-audit/core/contracts';
import { openRoute, readData } from '../support/app';
import { expect, test } from '../support/test';

// AN-4 on the default sample: Claude Code activity is optional and off, so the page explains how
// to enable it and shows no figures.
test.describe('Claude Code page without the optional source', () => {
  test('explains how to enable sources.claudeCode.enabled with a Console Admin key', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    expect(view.claudeCode).toBeUndefined();
    await openRoute(page, '/claude-code');
    await expect(page.getByRole('heading', { level: 1, name: 'Claude Code' })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Claude Code activity is not collected' }),
    ).toBeVisible();
    await expect(page.getByText('sources.claudeCode.enabled', { exact: true })).toBeVisible();
    await expect(page.getByText('ANTHROPIC_CONSOLE_ADMIN_API_KEY', { exact: true })).toBeVisible();
    await expect(page.getByRole('term')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the Overview engagement panel does not link to the empty page', async ({ page }) => {
    await openRoute(page, '/');
    await expect(page.getByRole('heading', { level: 3, name: 'Claude Code' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Claude Code page/ })).toHaveCount(0);
  });
});
