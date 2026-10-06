import type { DashboardView } from '@claude-audit/core/contracts';
import { openRoute, readData } from '../support/app';
import { expect, test } from '../support/test';

// AN-6 on the default sample: the feature usage source is optional and off, so the page explains
// how to enable it and shows no figures.
test.describe('Skills and connectors page without the optional source', () => {
  test('explains how to enable sources.featureUsage.enabled', async ({ page, request }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    expect(view.features).toBeUndefined();
    await openRoute(page, '/features');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Skills, connectors, plugins and projects' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'Skill, connector, plugin and project adoption is not collected',
      }),
    ).toBeVisible();
    await expect(page.getByText('sources.featureUsage.enabled', { exact: true })).toBeVisible();
    await expect(page.getByRole('term')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
