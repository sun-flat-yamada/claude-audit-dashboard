import type { DetailActivity } from '@claude-audit/core/contracts';
import { openRoute, readData } from '../support/app';
import { expect, test } from '../support/test';

type Item = DetailActivity['items'][number];
const PAGE_SIZE = 50;

const matches = (item: Item, query: string): boolean =>
  [item.type, item.actor.id, item.actor.email, item.actor.ip, item.organizationId].some((v) =>
    v?.toLowerCase().includes(query.toLowerCase()),
  );

const rows = (page: import('@playwright/test').Page) =>
  page.getByRole('table', { name: 'Activity timeline' }).locator('tbody tr');

test.describe('F-005 activity timeline', () => {
  test('shows the newest month first, 50 rows per page, with paging', async ({ page, request }) => {
    const sept = await readData<DetailActivity>(request, 'detail/activity-2026-09.json');
    expect(sept.items.length).toBeGreaterThan(PAGE_SIZE);
    await openRoute(page, '/activity');
    await expect(page.getByLabel('Month')).toHaveValue('2026-09');
    await expect(
      page.getByText(
        `Showing 1–${PAGE_SIZE} of ${sept.items.length} matching activities (${sept.total} in the month).`,
      ),
    ).toBeVisible();
    await expect(rows(page)).toHaveCount(PAGE_SIZE);
    const pager = page.getByRole('navigation', { name: 'Timeline pages' });
    await expect(
      pager.getByText(`Page 1 of ${Math.ceil(sept.items.length / PAGE_SIZE)}`),
    ).toBeVisible();
    await expect(pager.getByRole('button', { name: 'Previous page' })).toBeDisabled();

    const firstOfPageOne = (await rows(page).first().textContent()) ?? '';
    await pager.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText(`Showing ${PAGE_SIZE + 1}–`)).toBeVisible();
    await expect(rows(page)).toHaveCount(Math.min(PAGE_SIZE, sept.items.length - PAGE_SIZE));
    expect(await rows(page).first().textContent()).not.toBe(firstOfPageOne);
    await expect(pager.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await pager.getByRole('button', { name: 'Previous page' }).click();
    await expect(rows(page).first()).toHaveText(firstOfPageOne);
  });

  test('search matches type, identity, IP and organization; filters narrow further', async ({
    page,
    request,
  }) => {
    const sept = await readData<DetailActivity>(request, 'detail/activity-2026-09.json');
    await openRoute(page, '/activity');
    const query = 'sso_login';
    const expected = sept.items.filter((i) => matches(i, query));
    expect(expected.length).toBeGreaterThan(0);
    await page.getByRole('searchbox', { name: 'Search activity' }).fill(query);
    await expect(page.getByText(`of ${expected.length} matching activities`)).toBeVisible();
    await expect(rows(page)).toHaveCount(Math.min(PAGE_SIZE, expected.length));

    const failed = expected.filter((i) => i.type === 'sso_login_failed');
    await page.getByLabel('Activity type').selectOption('sso_login_failed');
    await expect(page.getByText(`of ${failed.length} matching activities`)).toBeVisible();
    await expect(rows(page).first()).toContainText('sso login failed');

    await page.getByLabel('Actor kind').selectOption('unauthenticated_user_actor');
    const unauth = failed.filter((i) => i.actor.kind === 'unauthenticated_user_actor');
    await expect(page.getByText(`of ${unauth.length} matching activities`)).toBeVisible();
  });

  test('date range, no-match message and reset by clearing', async ({ page, request }) => {
    const sept = await readData<DetailActivity>(request, 'detail/activity-2026-09.json');
    await openRoute(page, '/activity');
    const day = '2026-09-29';
    const onDay = sept.items.filter((i) => i.createdAt.slice(0, 10) >= day);
    await page.getByLabel('From date').fill(day);
    await expect(page.getByText(`of ${onDay.length} matching activities`)).toBeVisible();
    await page.getByLabel('To date').fill('2026-09-01');
    await expect(page.getByText('No activity matches the current filters.')).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    await page.getByLabel('To date').fill('');
    await page.getByLabel('From date').fill('');
    await page.getByRole('searchbox', { name: 'Search activity' }).fill('zzz-no-such-thing');
    await expect(page.getByText('No activity matches the current filters.')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search activity' }).fill('');
    await expect(page.getByText(`of ${sept.items.length} matching activities`)).toBeVisible();
  });

  test('switching the month loads that month and resets paging', async ({ page, request }) => {
    const aug = await readData<DetailActivity>(request, 'detail/activity-2026-08.json');
    await openRoute(page, '/activity');
    await page
      .getByRole('navigation', { name: 'Timeline pages' })
      .getByRole('button', { name: 'Next page' })
      .click();
    await page.getByLabel('Month').selectOption('2026-08');
    await expect(page.getByRole('heading', { level: 2, name: 'Activity timeline' })).toBeVisible();
    await expect(page.getByText('August 2026, newest first')).toBeVisible();
    await expect(
      page.getByText(
        `1–${Math.min(PAGE_SIZE, aug.items.length)} of ${aug.items.length} matching activities (${aug.total} in the month).`,
      ),
    ).toBeVisible();
    const first = aug.items[0];
    expect(first?.createdAt.startsWith('2026-08')).toBe(true);
    await expect(page.getByLabel('From date')).toHaveAttribute('min', '2026-08-01');
    await expect(page.getByLabel('From date')).toHaveAttribute('max', '2026-08-31');
  });

  test('identifiers are masked (maskPii is on)', async ({ page }) => {
    await openRoute(page, '/activity');
    await expect(
      page.getByText('Identifiers, e-mail addresses and IPs are masked (maskPii is on).'),
    ).toBeVisible();
    const text = await rows(page).first().locator('..').innerText();
    for (const email of text.match(/\S+@\S+/g) ?? []) expect(email).toContain('***');
  });
});
