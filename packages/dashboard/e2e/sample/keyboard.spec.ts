import type { Page } from '@playwright/test';
import { openRoute } from '../support/app';
import { STATIC_ROUTES } from '../support/routes';
import { expect, test } from '../support/test';

/** Navigation labels in Tab order: ungrouped, then the Usage, Directory and Operations groups. */
const NAV_LABELS = [
  'Overview',
  'Compliance',
  'Compare',
  'Models',
  'Claude Code',
  'Console API',
  'Skills & connectors',
  'Monthly report',
  'Members',
  'API keys',
  'Organizations',
  'Activity',
  'Alerts',
  'Configuration',
  'Archive',
];

/** Accessible name of the focused element (what a screen reader would announce first). */
const focusedName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return '';
    return (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
  });

async function tabTo(page: Page, name: RegExp | string, max = 60): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const current = await focusedName(page);
    if (typeof name === 'string' ? current === name : name.test(current)) return;
  }
  throw new Error(`Tab never reached "${String(name)}"`);
}

test.describe('keyboard only', () => {
  test('the skip link is the first stop, appears on focus and moves focus to the main area', async ({
    page,
  }) => {
    await openRoute(page, '/members');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
    await expect(page).toHaveURL(/#\/members$/);
    // The next Tab continues inside the main content, past the navigation.
    await page.keyboard.press('Tab');
    const inMain = await page.evaluate(() =>
      document.getElementById('main')?.contains(document.activeElement),
    );
    expect(inMain).toBe(true);
  });

  test('focus order: skip link, the navigation in order, the theme toggle, then the content', async ({
    page,
  }) => {
    await openRoute(page, '/');
    const seen: string[] = [];
    for (let i = 0; i < 1 + NAV_LABELS.length + 3 + 4; i += 1) {
      await page.keyboard.press('Tab');
      seen.push(await focusedName(page));
    }
    expect(seen.slice(0, 1 + NAV_LABELS.length + 3)).toEqual([
      'Skip to main content',
      ...NAV_LABELS,
      'Light',
      'Dark',
      'System',
    ]);
    // The sample carries three time points (F-015), so the Compliance card opens with the score
    // trend chart (named by its date axis), its "View as table" twin and the link to compare the
    // last two time points before the status filter.
    const [chart, table, compare, filter] = seen.slice(-4);
    expect(chart).toMatch(/^\d{2}-\d{2}/);
    expect(table).toBe('View as table');
    expect(compare).toBe('Compare the last two time points');
    expect(filter).toMatch(/^All \d+$/);
  });

  test('every screen opens from the navigation with Tab and Enter', async ({ page }) => {
    await openRoute(page, '/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const [index, route] of STATIC_ROUTES.entries()) {
      if (index === 0) continue;
      await tabTo(page, NAV_LABELS[index] ?? '');
      await page.keyboard.press('Enter');
      await expect(nav.locator('[aria-current="page"]')).toHaveText(NAV_LABELS[index] ?? '');
      await expect(page).toHaveURL(new RegExp(`#${route.path}$`));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // The activated link keeps focus, so the next Tab moves on to the following link.
      await expect(nav.getByRole('link', { name: NAV_LABELS[index] ?? '' })).toBeFocused();
    }
  });

  test('a status filter works with Enter and Space', async ({ page }) => {
    await openRoute(page, '/compliance');
    await tabTo(page, /^Fail \d+$/);
    await page.keyboard.press('Enter');
    const fail = page.getByRole('button', { name: /^Fail \d+$/ });
    await expect(fail).toHaveAttribute('aria-pressed', 'true');
    await tabTo(page, /^Review \d+$/);
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: /^Review \d+$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(fail).toHaveAttribute('aria-pressed', 'false');
  });

  test('a result row expands and collapses with Enter and Space', async ({ page }) => {
    await openRoute(page, '/compliance');
    const row = page.locator('details').filter({ hasNotText: 'View as table' }).first();
    await row.locator('summary').focus();
    await expect(row.locator('summary')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(row).toHaveAttribute('open', '');
    await page.keyboard.press('Space');
    await expect(row).not.toHaveAttribute('open', '');
    await page.keyboard.press('Space');
    await expect(row).toHaveAttribute('open', '');
  });

  test('the theme toggle works with the keyboard', async ({ page }) => {
    await openRoute(page, '/');
    await tabTo(page, 'Dark');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await tabTo(page, 'System');
    await page.keyboard.press('Space');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
    await expect(page.getByRole('button', { name: 'System' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('chart tables open with the keyboard', async ({ page }) => {
    await openRoute(page, '/');
    const summary = page.getByText('View as table').first();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('figure').first().getByRole('table')).toBeVisible();
  });

  test('activity filters, search and paging are operable', async ({ page }) => {
    await openRoute(page, '/activity');
    await page.getByLabel('Month').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByText('August 2026, newest first')).toBeVisible();
    // The month's file is still loading: wait for its filters before tabbing into them.
    await expect(page.getByRole('searchbox', { name: 'Search activity' })).toBeVisible();
    await expect(page.getByLabel('Month')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('searchbox', { name: 'Search activity' })).toBeFocused();
    await page.keyboard.type('sso_login');
    await expect(page.getByText(/of \d+ matching activities/)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Activity type')).toBeFocused();
    await page.keyboard.press('Control+a');
    await page.getByRole('searchbox', { name: 'Search activity' }).fill('');
    await tabTo(page, 'Next page');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/^Page 2 of/)).toBeVisible();
  });

  test('the heatmap is one tab stop with arrow-key movement and a live readout', async ({
    page,
  }) => {
    await openRoute(page, '/models');
    const cells = page.getByRole('grid').getByRole('button');
    await tabTo(page, /^claude-opus-5, Engineering:/);
    await expect(cells.first()).toBeFocused();
    await expect(
      page.getByRole('status').filter({ hasText: 'claude-opus-5 and Engineering' }),
    ).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(
      page.getByRole('status').filter({ hasText: 'claude-opus-5 and Sales' }),
    ).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('status').filter({ hasText: 'claude-sonnet-5 and Sales' }),
    ).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    await expect(cells.first()).toBeFocused();
    // One tab stop: the next Tab leaves the grid.
    await page.keyboard.press('Tab');
    const inGrid = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="grid"]')),
    );
    expect(inGrid).toBe(false);
  });

  test('keyboard focus is visible on links, buttons and fields', async ({ page }) => {
    await openRoute(page, '/members');
    for (const name of ['Skip to main content', 'Overview', 'Light', 'search field', /^All \d+$/]) {
      if (name === 'search field') {
        await page.getByRole('searchbox', { name: 'Search members' }).focus();
      } else {
        await tabTo(page, name);
      }
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const style = getComputedStyle(document.activeElement as Element);
              return (
                (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
                style.boxShadow !== 'none'
              );
            }),
          { message: `focus indicator of ${String(name)}` },
        )
        .toBe(true);
    }
  });
});

test.describe('keyboard only, narrow screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a wide table scrolls inside a focusable, named region', async ({ page }) => {
    await openRoute(page, '/activity');
    const region = page.getByRole('region', { name: 'Activity timeline', exact: true });
    await expect(region).toHaveAttribute('tabindex', '0');
    await region.focus();
    const before = await region.evaluate((el) => el.scrollLeft);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});
