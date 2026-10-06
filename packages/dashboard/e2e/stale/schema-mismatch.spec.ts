import { DASHBOARD_VIEW_SCHEMA_VERSION } from '@claude-audit/core/contracts';
import { openRoute } from '../support/app';
import { STATIC_ROUTES } from '../support/routes';
import { expect, test } from '../support/test';

test.describe('stale dashboard.json (schemaVersion mismatch)', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'stale-dashboard', 'runs on the stale-dashboard profile');
  });

  test('names the versions and the command that regenerates the data', async ({ page }) => {
    await page.goto('./');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Claude Audit Dashboard' }),
    ).toBeVisible();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Failed to load dashboard data');
    await expect(alert).toContainText(
      `schemaVersion 999; expected ${DASHBOARD_VIEW_SCHEMA_VERSION}`,
    );
    await expect(alert).toContainText('pnpm build:data');
    await expect(alert).toContainText('pnpm demo');
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
  });

  test('the same message appears on a deep link', async ({ page }) => {
    await page.goto('./#/members');
    await expect(page.getByRole('alert')).toContainText('Unsupported dashboard data');
  });
});

test.describe('stale detail files (schemaVersion mismatch)', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'stale-detail', 'runs on the stale-detail profile');
  });

  test('the overview still renders from the valid dashboard.json', async ({ page }) => {
    await openRoute(page, '/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Claude Enterprise Audit Dashboard' }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  // Screens that read dashboard.json only (overview, compliance, models, Claude Code, Console API,
  // skills and connectors) never fetch detail files.
  const DASHBOARD_ONLY = ['/', '/compliance', '/models', '/claude-code', '/console', '/features'];
  const detailScreens = STATIC_ROUTES.filter((r) => !DASHBOARD_ONLY.includes(r.path));
  for (const screen of detailScreens) {
    test(`${screen.path} reports the outdated file and how to regenerate it`, async ({ page }) => {
      await openRoute(page, screen.path);
      const alert = page.getByRole('alert');
      await expect(alert).toBeVisible();
      await expect(alert).toContainText('Failed to load');
      await expect(alert).toContainText('schemaVersion 999');
      await expect(alert).toContainText('pnpm build:detail');
      // No raw validator output.
      await expect(alert).not.toContainText('invalid_value');
    });
  }

  test('the compare screen names the outdated index file and the command', async ({ page }) => {
    await openRoute(page, '/compare');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Compare time points' }),
    ).toBeVisible();
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText(
      'Failed to load time-point comparison data: detail/compare/index.json is not in the supported format (schemaVersion 999). Re-run `pnpm build:detail` (or `pnpm demo` for the sample data) to regenerate it.',
    );
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('a deep link to a pair of points shows the same message', async ({ page }) => {
    await page.goto('./#/compare?base=2026-09-01T12-00-00Z&target=2026-09-29T12-00-00Z');
    await expect(page.getByRole('alert')).toContainText('detail/compare/index.json');
    await expect(page.getByRole('alert')).toContainText('pnpm build:detail');
  });

  test('an organization page names the problem as well', async ({ page }) => {
    await openRoute(page, '/orgs/5f0c7a1e-1111-4a1a-9a11-000000000001');
    await expect(page.getByRole('heading', { level: 1, name: 'Organization' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('schemaVersion 999');
  });
});
