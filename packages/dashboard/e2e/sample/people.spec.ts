import type { DashboardView, DetailApiKeys, DetailMembers } from '@claude-audit/core/contracts';
import type { Page } from '@playwright/test';
import { openRoute, readData } from '../support/app';
import { expect, test } from '../support/test';

const bodyRows = (page: Page, name: string) =>
  page.getByRole('table', { name, exact: true }).locator('tbody tr');
const chip = (page: Page, group: string, label: string) =>
  page
    .getByRole('group', { name: group })
    .getByRole('button', { name: new RegExp(`^${label} \\d+$`) });

test.describe('F-006 members', () => {
  test('lists every member with role, last activity and status; the summary adds up', async ({
    page,
    request,
  }) => {
    const data = await readData<DetailMembers>(request, 'detail/members.json');
    await openRoute(page, '/members');
    await expect(bodyRows(page, 'Members')).toHaveCount(data.members.length);
    await expect(page.getByText('Members', { exact: true }).first()).toBeVisible();
    const summary = await page
      .getByText(/^\d+ members: \d+ active, \d+ inactive, \d+ unknown\./)
      .textContent();
    const [total, active, inactive, unknown] = (summary ?? '').match(/\d+/g)?.map(Number) ?? [];
    expect(total).toBe(data.members.length);
    expect((active ?? 0) + (inactive ?? 0) + (unknown ?? 0)).toBe(total);
    await expect(
      page.getByText(`${data.inactiveDays} days without activity (AC-001)`),
    ).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Pending invites' }).locator('tbody tr'),
    ).toHaveCount(data.invites.length);
  });

  test('AC-001: the inactive count equals the compliance finding and inactive rows are labelled', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    const ac001 = view.compliance.results.find((r) => r.ruleId === 'AC-001');
    const failing = Number(/^(\d+) member/.exec(ac001?.message ?? '')?.[1]);
    await openRoute(page, '/members');
    await chip(page, 'Filter by status', 'Inactive').click();
    await expect(chip(page, 'Filter by status', 'Inactive')).toHaveText(`Inactive ${failing}`);
    const rows = bodyRows(page, 'Members');
    await expect(rows).toHaveCount(failing);
    for (const row of await rows.all()) {
      await expect(row.getByRole('cell', { name: 'Inactive' })).toBeVisible();
      await expect(row).toContainText('No activity recorded');
    }
  });

  test('search, role filter and sorting', async ({ page, request }) => {
    const data = await readData<DetailMembers>(request, 'detail/members.json');
    await openRoute(page, '/members');
    const rows = bodyRows(page, 'Members');

    const target = data.members[0]?.email ?? '';
    const found = data.members.filter(
      (m) =>
        m.email.toLowerCase().includes(target.toLowerCase()) ||
        m.name.toLowerCase().includes(target.toLowerCase()),
    );
    await page.getByRole('searchbox', { name: 'Search members' }).fill(target);
    await expect(rows).toHaveCount(found.length);
    await page.getByRole('searchbox', { name: 'Search members' }).fill('no-such-member');
    await expect(page.getByText('No members match the current filters.')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search members' }).fill('');

    const owners = data.members.filter((m) => m.role === 'owner');
    expect(owners.length).toBeGreaterThan(0);
    await page.getByRole('combobox', { name: 'Role' }).selectOption('owner');
    await expect(rows).toHaveCount(owners.length);
    await page.getByRole('combobox', { name: 'Role' }).selectOption('all');

    await page.getByLabel('Sort by').selectOption('name');
    const ascending = await rows.locator('th').allTextContents();
    await page.getByRole('button', { name: 'Descending' }).click();
    await expect(page.getByRole('button', { name: 'Descending' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await rows.locator('th').allTextContents()).toEqual([...ascending].reverse());
  });

  test('names and e-mail addresses are masked', async ({ page }) => {
    await openRoute(page, '/members');
    await expect(
      page.getByText('Names and e-mail addresses are masked (maskPii is on).'),
    ).toBeVisible();
    const text = await page.getByRole('main').innerText();
    const emails = text.match(/\S+@\S+/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) expect(email).toContain('***@');
  });
});

test.describe('F-007 API key inventory', () => {
  test('lists every key with age, expiry, last use and a recommendation', async ({
    page,
    request,
  }) => {
    const data = await readData<DetailApiKeys>(request, 'detail/api-keys.json');
    await openRoute(page, '/keys');
    const rows = bodyRows(page, 'API keys');
    await expect(rows).toHaveCount(data.keys.length);
    for (const key of data.keys)
      await expect(page.getByRole('rowheader', { name: key.name })).toBeVisible();
    await expect(
      page.getByText(`A key is old after ${data.maxAgeDays} days (AK-003)`),
    ).toBeVisible();
    await expect(
      page.getByText(`unused after ${data.unusedDays} days without API calls (AK-001)`),
    ).toBeVisible();
    await expect(page.getByText('Key secrets are never collected or shown.')).toBeVisible();
  });

  test('recommendation chips add up to the inventory and filter the table', async ({
    page,
    request,
  }) => {
    const data = await readData<DetailApiKeys>(request, 'detail/api-keys.json');
    await openRoute(page, '/keys');
    const group = page.getByRole('group', { name: /Filter by/ });
    let sum = 0;
    for (const button of await group.getByRole('button').all()) {
      const [label, count] = ((await button.textContent()) ?? '').split(/ (?=\d+$)/);
      if (label === 'All') {
        expect(Number(count)).toBe(data.keys.length);
        continue;
      }
      sum += Number(count);
      await button.click();
      await expect(
        bodyRows(page, 'API keys').or(page.getByText('No keys match the current filters.')),
      ).toHaveCount(Number(count) === 0 ? 1 : Number(count));
    }
    expect(sum).toBe(data.keys.length);
  });

  test('the key that breaks AK-003 is flagged "Rotate" and found by search', async ({
    page,
    request,
  }) => {
    const view = await readData<DashboardView>(request, 'dashboard.json');
    expect(view.compliance.results.find((r) => r.ruleId === 'AK-003')?.status).toBe('fail');
    await openRoute(page, '/keys');
    await page.getByRole('searchbox', { name: 'Search keys' }).fill('siem');
    const rows = bodyRows(page, 'API keys');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Rotate');
    await expect(rows.first()).toContainText('over the 180-day limit (AK-003)');
    await page.getByRole('searchbox', { name: 'Search keys' }).fill('no-such-key');
    await expect(page.getByText('No keys match the current filters.')).toBeVisible();
  });

  test('key IDs are masked and no secret-looking value is shown', async ({ page }) => {
    await openRoute(page, '/keys');
    await expect(page.getByText('Key IDs are masked (maskPii is on).')).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText(/sk-ant-/);
  });
});
