import { STATIC_ROUTES } from '../support/routes';
import { openRoute } from '../support/app';
import { expect, test } from '../support/test';

const nav = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Primary' });

const current = (page: import('@playwright/test').Page) =>
  nav(page).locator('[aria-current="page"]');

test.describe('navigation and routing under the Pages base path', () => {
  test('serves from /claude-audit-dashboard/ and every nav link marks the current page', async ({
    page,
  }) => {
    await openRoute(page, '/');
    expect(new URL(page.url()).pathname).toBe('/claude-audit-dashboard/');
    const links = nav(page).getByRole('link');
    await expect(links).toHaveCount(STATIC_ROUTES.length);
    await expect(current(page)).toHaveText('Overview');
    for (const link of await links.all()) {
      const label = (await link.textContent()) ?? '';
      await link.click();
      await expect(current(page)).toHaveText(label);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('a deep link opens its screen, also after a reload', async ({ page }) => {
    await openRoute(page, '/members');
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await expect(current(page)).toHaveText('Members');
  });

  test('back and forward follow the history', async ({ page }) => {
    await openRoute(page, '/');
    await nav(page).getByRole('link', { name: 'Compliance' }).click();
    await nav(page).getByRole('link', { name: 'Members' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Compliance results' })).toBeVisible();
    await expect(current(page)).toHaveText('Compliance');
    await page.goForward();
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  });

  test('a parametrised screen keeps its parent nav item current', async ({ page }) => {
    await openRoute(page, '/reports/monthly/monthly-2026-08');
    await expect(current(page)).toHaveText('Monthly report');
    await openRoute(page, '/groups/rbac_group_demo_engineering');
    await expect(current(page)).toHaveText('Organizations');
  });

  test('an unknown route says so and links back to the overview', async ({ page }) => {
    await openRoute(page, '/no-such-page');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('main').getByText('/no-such-page')).toBeVisible();
    await expect(current(page)).toHaveCount(0);
    await page.getByRole('link', { name: 'Back to the overview' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Claude Enterprise Audit Dashboard' }),
    ).toBeVisible();
  });

  test('an unknown organization and group show a not-found notice', async ({ page }) => {
    await openRoute(page, '/orgs/does-not-exist');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Organization not found' }),
    ).toBeVisible();
    await openRoute(page, '/groups/does-not-exist');
    await expect(page.getByRole('heading', { level: 1, name: 'Group not found' })).toBeVisible();
  });
});
