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

// AN-6: the skills and connectors page with the optional source collected ("optional-sources")
// and enabled but denied ("optional-unavailable": HTTP 403, no read:analytics).
test.describe('Skills and connectors page with the optional source', () => {
  test('shows the counts, ranked lists, connector call split and table twins', async ({
    page,
    request,
  }, info) => {
    test.skip(info.project.name !== 'optional-sources', 'runs on the optional-sources profile');
    const view = await readData<DashboardView>(request, 'dashboard.json');
    const f = view.features;
    expect(f?.skills).toBeTruthy();
    if (!f?.skills || !f.connectors || !f.plugins || !f.projects) return;
    await openRoute(page, '/features');
    const tile = (label: string) =>
      page
        .getByRole('term')
        .filter({ hasText: new RegExp(`^${label}$`) })
        .locator('xpath=..');
    await expect(tile('Skills used')).toContainText(integer.format(f.skills.total));
    await expect(tile('Connectors used')).toContainText(integer.format(f.connectors.total));
    await expect(tile('Active chat projects')).toContainText(integer.format(f.projects.total));
    for (const title of [
      'Top skills',
      'Top connectors',
      'Connector calls by kind',
      'Top plugins',
      'Top chat projects',
    ])
      await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
    const top = f.connectors.items[0];
    await expect(
      page.getByRole('img', { name: new RegExp(`^${top?.label ?? ''}, `) }),
    ).toBeVisible();
    const projects = page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: 'Top chat projects' }),
    });
    await expect(projects.getByText(f.projects.items[0]?.label ?? '').first()).toBeVisible();
    await projects.getByText('View as table').click();
    await expect(projects.locator('tbody tr')).toHaveCount(f.projects.items.length);
    // Aggregates only: no address, user id or creator on the page.
    await expect(page.getByText(/@example\.com|user_|created by/i)).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('when denied it names the reason and the enabling steps', async ({ page }, info) => {
    test.skip(
      info.project.name !== 'optional-unavailable',
      'runs on the optional-unavailable profile',
    );
    await openRoute(page, '/features');
    await expect(page.getByRole('status')).toContainText('read:analytics');
    await expect(page.getByRole('status')).toContainText('skillUsage');
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'Skill, connector, plugin and project adoption is not collected',
      }),
    ).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe ${theme}: /features`, async ({ page }, testInfo) => {
      await presetTheme(page, theme);
      await openRoute(page, '/features');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const violations = await scan(page, testInfo, `${theme}_features`);
      expect(blocking(violations), 'critical / serious axe violations').toEqual([]);
    });
  }

  test('390px: no horizontal page scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRoute(page, '/features');
    expect(await pageScrollsHorizontally(page)).toBe(false);
  });
});
