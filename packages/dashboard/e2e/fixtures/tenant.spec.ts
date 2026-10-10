import type {
  DashboardView,
  DetailApiKeys,
  DetailMembers,
  DetailOrgGroups,
} from '@claude-audit/core/contracts';
import type { Page } from '@playwright/test';
import { openRoute, readData } from '../support/app';
import { expect, test } from '../support/test';

const bodyRows = (page: Page, name: string) =>
  page.getByRole('table', { name, exact: true }).locator('tbody tr');

// Profile "fixtures": the output of `pnpm fixture` (collect, check and build on the fixture tenant).
test.describe('B1 fixture tenant', () => {
  test('the overview shows the tenant score, the Demo badge and every dataset as collected', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    await openRoute(page, '/');
    await expect(page.getByText('Demo data (synthetic tenant)')).toBeVisible();
    await expect(
      page.getByText(String(view.compliance.score), { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator('details').filter({ hasNotText: 'View as table' })).toHaveCount(
      view.compliance.results.length,
    );
    const coverage = page.locator('section', {
      has: page.getByRole('heading', { name: 'Data coverage' }),
    });
    await expect(coverage.locator('tbody tr')).toHaveCount(view.coverage.length);
    await expect(coverage.locator('tbody tr', { hasText: 'Collected' })).toHaveCount(
      view.coverage.filter((c) => c.status === 'ok').length,
    );
  });

  test('members, API keys and organizations come from the fixture detail files', async ({
    page,
    request,
  }) => {
    const members = await readData<DetailMembers>(request, 'detail/members.json');
    const keys = await readData<DetailApiKeys>(request, 'detail/api-keys.json');
    const orgs = await readData<DetailOrgGroups>(request, 'detail/org-groups.json');
    await openRoute(page, '/members');
    await expect(bodyRows(page, 'Members')).toHaveCount(members.members.length);
    await openRoute(page, '/keys');
    await expect(bodyRows(page, 'API keys')).toHaveCount(keys.keys.length);
    await openRoute(page, '/orgs');
    await expect(bodyRows(page, 'Linked organizations')).toHaveCount(orgs.organizations.length);
    await expect(bodyRows(page, 'RBAC groups')).toHaveCount(orgs.groups.length);
    await page.getByRole('link', { name: orgs.groups[0]?.name ?? '', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: orgs.groups[0]?.name })).toBeVisible();
  });

  test('activity shows the fixture month', async ({ page }) => {
    await openRoute(page, '/activity');
    await expect(page.getByLabel('Month')).toHaveValue('2026-09');
    await expect(page.getByRole('table', { name: 'Activity timeline' })).toBeVisible();
  });

  test('monthly report and model spend are published and displayed on the fixture tenant', async ({
    page,
  }) => {
    await openRoute(page, '/reports/monthly');
    await expect(page.getByRole('table', { name: 'Monthly reports' })).toBeVisible();
    await openRoute(page, '/models');
    await expect(page.getByRole('heading', { level: 1, name: 'Models' })).toBeVisible();
    await openRoute(page, '/');
    await expect(page.getByRole('heading', { level: 2, name: 'Model spend' })).toBeVisible();
    await openRoute(page, '/archive');
    await expect(page.getByText('No archived snapshots yet.')).toBeVisible();
    await openRoute(page, '/alerts');
    await expect(page.getByText('No alerts sent yet.')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the compliance export works on the tenant', async ({ page, request }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    await openRoute(page, '/compliance');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export all JSON' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      `compliance-results-${(view.collectedAt ?? '').slice(0, 10).replaceAll('-', '')}.json`,
    );
    const { readFile } = await import('node:fs/promises');
    const parsed = JSON.parse(await readFile(await download.path(), 'utf-8')) as { count: number };
    expect(parsed.count).toBe(view.compliance.results.length);
  });
});
