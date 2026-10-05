import { openRoute } from '../support/app';
import { expect, test } from '../support/test';

// Profile "unavailable": dashboard.json only; every detail file answers 404.
const SCREENS = [
  { path: '/members', heading: 'Members', notice: 'Member data is not published.' },
  { path: '/keys', heading: 'API keys', notice: 'API key data is not published.' },
  { path: '/activity', heading: 'Activity', notice: 'Activity data is not published.' },
  {
    path: '/reports/monthly',
    heading: 'Monthly cost report',
    notice: 'Monthly cost reports are not published.',
  },
  { path: '/models', heading: 'Models', notice: 'Model and group spend data is not published.' },
  { path: '/config', heading: 'Configuration', notice: 'Configuration data is not published.' },
  { path: '/archive', heading: 'Archive', notice: 'Archive data is not published.' },
  { path: '/alerts', heading: 'Alerts', notice: 'Alert history data is not published.' },
  {
    path: '/orgs',
    heading: 'Organizations',
    notice: 'Organization and group data is not published.',
  },
];

test.describe('detail data not published (404)', () => {
  for (const screen of SCREENS) {
    test(`${screen.path} explains that the data is not published`, async ({ page }) => {
      await openRoute(page, screen.path);
      await expect(page.getByRole('heading', { level: 1, name: screen.heading })).toBeVisible();
      const notice = page.getByRole('status').filter({ hasText: screen.notice });
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('PAGES_DETAIL_DATA');
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByRole('table')).toHaveCount(0);
    });
  }

  test('detail pages of one organization and group say the same, with a way back', async ({
    page,
  }) => {
    await openRoute(page, '/orgs/any');
    await expect(page.getByRole('link', { name: 'All organizations and groups' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('is not published');
    await openRoute(page, '/groups/any');
    await expect(page.getByRole('status')).toContainText('is not published');
    await openRoute(page, '/reports/monthly/monthly-2026-08');
    await expect(page.getByRole('status')).toContainText('not published');
  });

  test('the overview does not depend on the detail files', async ({ page }) => {
    await openRoute(page, '/');
    await expect(page.getByText('Demo data (synthetic tenant)')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Compliance checks' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
