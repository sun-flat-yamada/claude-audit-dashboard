import { blocking, openRoute, presetTheme, scan } from '../support/app';
import { expect, test } from '../support/test';

// axe on states the plain route scans do not open: expanded rows, chart tables, filters, table views.
for (const theme of ['light', 'dark'] as const) {
  test.describe(`axe, interactive states, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await presetTheme(page, theme);
    });

    test('compliance: every row expanded, a filter applied', async ({ page }, testInfo) => {
      await openRoute(page, '/compliance');
      await page.getByRole('button', { name: /^Fail \d+$/ }).click();
      for (const summary of await page.locator('details summary').all()) await summary.click();
      expect(blocking(await scan(page, testInfo, `${theme}-compliance-expanded`))).toEqual([]);
    });

    test('overview: every chart table open', async ({ page }, testInfo) => {
      await openRoute(page, '/');
      for (const summary of await page.getByText('View as table').all()) await summary.click();
      expect(blocking(await scan(page, testInfo, `${theme}-overview-tables`))).toEqual([]);
    });

    test('models: table view and a focused heatmap cell', async ({ page }, testInfo) => {
      await openRoute(page, '/models');
      await page.getByRole('grid').getByRole('button').first().focus();
      expect(blocking(await scan(page, testInfo, `${theme}-models-focused`))).toEqual([]);
      await page.getByRole('button', { name: 'View as table' }).click();
      expect(blocking(await scan(page, testInfo, `${theme}-models-table`))).toEqual([]);
    });

    test('activity: second page and a no-match filter', async ({ page }, testInfo) => {
      await openRoute(page, '/activity');
      await page.getByRole('button', { name: 'Next page' }).click();
      expect(blocking(await scan(page, testInfo, `${theme}-activity-page2`))).toEqual([]);
      await page.getByRole('searchbox', { name: 'Search activity' }).fill('zzz');
      await expect(page.getByText('No activity matches the current filters.')).toBeVisible();
      expect(blocking(await scan(page, testInfo, `${theme}-activity-empty`))).toEqual([]);
    });

    test('members and keys: filtered to one status', async ({ page }, testInfo) => {
      await openRoute(page, '/members');
      await page.getByRole('button', { name: /^Inactive \d+$/ }).click();
      expect(blocking(await scan(page, testInfo, `${theme}-members-inactive`))).toEqual([]);
      await openRoute(page, '/keys');
      await page.getByRole('button', { name: /^Rotate \d+$/ }).click();
      expect(blocking(await scan(page, testInfo, `${theme}-keys-rotate`))).toEqual([]);
    });
  });
}

test.describe('axe on a phone-sized screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const path of ['/', '/compliance', '/activity', '/config', '/models']) {
    test(`390px ${path}`, async ({ page }, testInfo) => {
      await openRoute(page, path);
      expect(blocking(await scan(page, testInfo, `390${path.replaceAll('/', '_')}`))).toEqual([]);
    });
  }
});
