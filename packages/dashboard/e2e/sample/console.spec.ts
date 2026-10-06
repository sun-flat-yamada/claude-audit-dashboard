import type { DashboardView } from '@claude-audit/core/contracts';
import { openRoute, readData } from '../support/app';
import { expect, test } from '../support/test';

// AN-5 on the default sample: the Console Admin API source is optional and off, so the page
// explains how to enable it and shows no figures.
test.describe('Console API page without the optional source', () => {
  test('explains how to enable sources.console.enabled with a Console Admin key', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    expect(view.console).toBeUndefined();
    await openRoute(page, '/console');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Console API usage and cost' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'Console API usage and cost are not collected',
      }),
    ).toBeVisible();
    await expect(page.getByText('sources.console.enabled', { exact: true })).toBeVisible();
    await expect(page.getByText('ANTHROPIC_CONSOLE_ADMIN_API_KEY', { exact: true })).toBeVisible();
    await expect(page.getByRole('term')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
