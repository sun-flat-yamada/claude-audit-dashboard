import type {
  DetailConfig,
  DetailOrgGroups,
  DetailUsageMatrix,
} from '@claude-audit/core/contracts';
import type { Page } from '@playwright/test';
import { openRoute, readData } from '../support/app';
import { expect, test } from '../support/test';

const bodyRows = (page: Page, name: string) =>
  page.getByRole('table', { name, exact: true }).locator('tbody tr');
const money = (value: number, digits = 2) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
const grid = (page: Page) => page.getByRole('grid', { name: 'Model by group spend heatmap' });

test.describe('F-010 models x groups heatmap', () => {
  test('draws one named cell per model and group; focusing a cell fills the readout', async ({
    page,
    request,
  }) => {
    const matrix = await readData<DetailUsageMatrix>(request, 'detail/usage-matrix.json');
    await openRoute(page, '/models');
    await expect(grid(page).getByRole('button')).toHaveCount(
      matrix.models.length * matrix.groups.length,
    );
    await expect(grid(page).getByRole('columnheader')).toHaveCount(matrix.groups.length);
    await expect(grid(page).getByRole('rowheader')).toHaveCount(matrix.models.length);
    await expect(page.getByText('Hover or focus a cell to see its exact value.')).toBeVisible();

    const model = matrix.models[0];
    const group = matrix.groups[0];
    const total = matrix.cells
      .filter((c) => c.model === model?.key && c.group === group?.key)
      .reduce((s, c) => s + c.cost, 0);
    const cell = grid(page).getByRole('button', {
      name: new RegExp(`^${model?.name}, ${group?.name}: `),
    });
    await expect(cell).toHaveAttribute(
      'aria-label',
      new RegExp(money(total).replace('$', '\\$').replace('.', '\\.')),
    );
    await cell.focus();
    await expect(
      page.getByRole('status').filter({ hasText: `${model?.name} and ${group?.name}` }),
    ).toContainText(money(total));
    await expect(page.getByRole('img', { name: /^Color scale from \$0\.00/ })).toBeVisible();
  });

  test('"View as table" swaps the heatmap and the mix for tables with the same numbers', async ({
    page,
    request,
  }) => {
    const matrix = await readData<DetailUsageMatrix>(request, 'detail/usage-matrix.json');
    await openRoute(page, '/models');
    await page.getByRole('button', { name: 'View as table' }).click();
    await expect(grid(page)).toHaveCount(0);
    const spend = bodyRows(page, 'Model by group spend');
    // "All months": one row per model and group, with the cost summed over the months.
    const sums = new Map<string, number>();
    for (const c of matrix.cells)
      sums.set(`${c.model}|${c.group}`, (sums.get(`${c.model}|${c.group}`) ?? 0) + c.cost);
    await expect(spend).toHaveCount(sums.size);
    await expect(spend.first()).toContainText(money(Math.max(...sums.values())));
    await expect(bodyRows(page, 'Model mix by month')).toHaveCount(matrix.mix.length);
    await page.getByRole('button', { name: 'View as chart' }).click();
    await expect(grid(page)).toBeVisible();
  });

  test('period and search narrow the matrix', async ({ page, request }) => {
    const matrix = await readData<DetailUsageMatrix>(request, 'detail/usage-matrix.json');
    await openRoute(page, '/models');
    const all = await grid(page).getByRole('button').first().getAttribute('aria-label');
    await page.getByRole('combobox', { name: 'Period' }).selectOption(matrix.months[0] ?? '');
    await expect(grid(page).getByRole('button').first()).not.toHaveAttribute(
      'aria-label',
      all ?? '',
    );
    await page.getByRole('combobox', { name: 'Period' }).selectOption('all');
    const model = matrix.models[0];
    await page.getByRole('searchbox', { name: 'Search models and groups' }).fill(model?.name ?? '');
    await expect(grid(page).getByRole('rowheader')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search models and groups' }).fill('no-such-model');
    await expect(page.getByText('No models or groups match “no-such-model”.')).toBeVisible();
  });

  test('the monthly mix names every month with its total and shares', async ({ page, request }) => {
    const matrix = await readData<DetailUsageMatrix>(request, 'detail/usage-matrix.json');
    await openRoute(page, '/models');
    for (const total of matrix.monthTotals) {
      await expect(
        page.getByRole('img', {
          name: new RegExp(`total ${money(total.cost).replace('$', '\\$').replace('.', '\\.')}:`),
        }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole('list', { name: 'Model mix legend' }).getByRole('listitem'),
    ).toHaveCount(matrix.models.length);
    await expect(page.getByText('Groups overlap')).toBeVisible();
  });
});

test.describe('F-012 organizations and groups', () => {
  test('lists organizations and groups and drills down to each', async ({ page, request }) => {
    const data = await readData<DetailOrgGroups>(request, 'detail/org-groups.json');
    await openRoute(page, '/orgs');
    await expect(bodyRows(page, 'Linked organizations')).toHaveCount(data.organizations.length);
    await expect(bodyRows(page, 'RBAC groups')).toHaveCount(data.groups.length);

    const withDeviation = data.organizations.find((o) =>
      data.deviations.some((d) => d.organizationId === o.id),
    );
    expect(withDeviation).toBeDefined();
    await page.getByRole('link', { name: withDeviation?.name ?? '', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/orgs/${withDeviation?.id}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: withDeviation?.name ?? '' }),
    ).toBeVisible();
    const expected = data.deviations.filter((d) => d.organizationId === withDeviation?.id);
    await expect(page.getByText(`${expected.length} found`)).toBeVisible();
    await expect(bodyRows(page, 'Configuration deviations')).toHaveCount(expected.length);
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).locator('[aria-current="page"]'),
    ).toHaveText('Organizations');
    await page.getByRole('link', { name: 'All organizations and groups' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Organizations' })).toBeVisible();

    const group = data.groups[0];
    await page.getByRole('link', { name: group?.name ?? '', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: group?.name ?? '' })).toBeVisible();
    await expect(page.getByText(String(group?.memberCount))).toBeVisible();
    await expect(page.getByText(money(group?.monthToDateCost ?? 0))).toBeVisible();
    await expect(page.getByText('Groups overlap')).toBeVisible();
  });

  test('search narrows both lists', async ({ page }) => {
    await openRoute(page, '/orgs');
    await page.getByRole('searchbox', { name: 'Search organizations and groups' }).fill('legal');
    await expect(bodyRows(page, 'Linked organizations')).toHaveCount(1);
    await expect(bodyRows(page, 'RBAC groups')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search organizations and groups' }).fill('zzzz');
    await expect(page.getByText('No organizations match the search.')).toBeVisible();
    await expect(page.getByText('No groups match the search.')).toBeVisible();
  });
});

test.describe('F-014 configuration view', () => {
  test('counts, tables and the filter chips match the published configuration', async ({
    page,
    request,
  }) => {
    const config = await readData<DetailConfig>(request, 'detail/config.json');
    await openRoute(page, '/config');
    const enabled = config.rules.filter((r) => r.enabled).length;
    const custom = config.rules.filter((r) => r.origin !== 'builtin').length;
    await expect(
      page.getByText(
        new RegExp(
          `^${config.rules.length} rules: ${enabled} enabled, ${config.rules.length - enabled} disabled, ${custom} custom\\.`,
        ),
      ),
    ).toBeVisible();
    await expect(bodyRows(page, 'Compliance rules')).toHaveCount(config.rules.length);
    await expect(bodyRows(page, 'Custom rules')).toHaveCount(config.customRules.length);
    await expect(bodyRows(page, 'Notification channels')).toHaveCount(
      config.notifications.channels.length,
    );
    await expect(bodyRows(page, 'Data sources')).toHaveCount(config.sources.datasets.length);
    await page.getByRole('button', { name: /^Disabled \d+$/ }).click();
    await expect(bodyRows(page, 'Compliance rules')).toHaveCount(config.rules.length - enabled);
    await page.getByRole('button', { name: /^Custom \d+$/ }).click();
    await expect(bodyRows(page, 'Compliance rules')).toHaveCount(custom);
  });

  test('search finds a rule and a parameter', async ({ page }) => {
    await openRoute(page, '/config');
    await page.getByRole('searchbox', { name: 'Search configuration' }).fill('AC-001');
    await expect(bodyRows(page, 'Compliance rules')).toHaveCount(1);
    await expect(page.getByRole('table', { name: 'Compliance rules' })).toContainText(
      'Inactive Members',
    );
    await expect(bodyRows(page, 'Rule parameters').first()).toContainText('inactiveDays');
  });

  test('never shows secrets, URLs, e-mail addresses or file paths', async ({ page }) => {
    await openRoute(page, '/config');
    await expect(
      page.getByText(
        'Secrets, webhook URLs, addresses and file paths are never part of this view.',
      ),
    ).toBeVisible();
    const text = await page.getByRole('main').innerText();
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/\S+@\S+\.\S+/);
    expect(text).not.toMatch(/sk-ant-|hooks\.slack\.com|\/home\/|C:\\/);
  });
});
