import { openRoute } from '../support/app';
import { expect, test } from '../support/test';

// Profile "empty": the detail files are published but hold no rows.
test.describe('empty displays', () => {
  test('members', async ({ page }) => {
    await openRoute(page, '/members');
    await expect(page.getByText('No members in this organization.')).toBeVisible();
    await expect(page.getByText('0 members: 0 active, 0 inactive, 0 unknown.')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(
      page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: 'All 0' }),
    ).toBeVisible();
  });

  test('API keys', async ({ page }) => {
    await openRoute(page, '/keys');
    await expect(page.getByText('No API keys in this organization.')).toBeVisible();
    await expect(page.getByText('0 keys (0 active): 0 need action.')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('alerts', async ({ page }) => {
    await openRoute(page, '/alerts');
    await expect(page.getByText('No alerts sent yet.')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'How to acknowledge an alert' }),
    ).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('organizations and groups', async ({ page }) => {
    await openRoute(page, '/orgs');
    await expect(page.getByText('No linked organizations.')).toBeVisible();
    await expect(page.getByText('No RBAC groups.')).toBeVisible();
    await openRoute(page, '/orgs/any');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Organization not found' }),
    ).toBeVisible();
  });

  test('archive', async ({ page }) => {
    await openRoute(page, '/archive');
    await expect(page.getByText('No archived snapshots yet.')).toBeVisible();
    await expect(page.getByText(/No archives yet/)).toBeVisible();
    await expect(page.getByText('0 B')).toBeVisible();
  });

  test('activity', async ({ page }) => {
    await openRoute(page, '/activity');
    await expect(page.getByText('No activity was recorded in September 2026.')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('screens that do not depend on the emptied files still render their data', async ({
    page,
  }) => {
    await openRoute(page, '/models');
    await expect(page.getByRole('grid', { name: 'Model by group spend heatmap' })).toBeVisible();
    await openRoute(page, '/config');
    await expect(page.getByRole('table', { name: 'Compliance rules' })).toBeVisible();
  });
});
