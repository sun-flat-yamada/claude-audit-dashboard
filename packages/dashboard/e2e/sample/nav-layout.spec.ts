import type { Page } from '@playwright/test';
import { blocking, openRoute, pageScrollsHorizontally, presetTheme, scan } from '../support/app';
import { STATIC_ROUTES } from '../support/routes';
import { expect, test } from '../support/test';

// AN-7 (#112): the grouped navigation never hides an item behind a horizontal scroll.

const nav = (page: Page) => page.getByRole('navigation', { name: 'Primary' });
const menu = (page: Page) => nav(page).getByRole('button', { name: 'Menu' });

/** Links whose box is not fully inside the viewport, or that are clipped by a scrolling ancestor. */
const clippedLinks = (page: Page) =>
  nav(page)
    .getByRole('link')
    .evaluateAll((links) =>
      links
        .filter((link) => {
          const box = link.getBoundingClientRect();
          const outside =
            box.width === 0 ||
            box.left < 0 ||
            box.top < 0 ||
            box.right > window.innerWidth ||
            box.bottom > window.innerHeight;
          const list = link.closest('ul');
          return outside || (list !== null && list.scrollWidth > list.clientWidth);
        })
        .map((link) => link.textContent ?? ''),
    );

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 1024, height: 768 },
]) {
  test.describe(`${viewport.width}px wide`, () => {
    test.use({ viewport });

    test('every navigation item is visible without scrolling, in named groups', async ({
      page,
    }) => {
      await openRoute(page, '/');
      await expect(menu(page)).toBeHidden();
      await expect(nav(page).getByRole('link')).toHaveCount(STATIC_ROUTES.length);
      expect(await clippedLinks(page)).toEqual([]);
      for (const group of ['Usage', 'Directory', 'Operations']) {
        await expect(nav(page).getByRole('list', { name: group })).toBeVisible();
      }
      await expect(nav(page).getByRole('list', { name: 'Directory' }).getByRole('link')).toHaveText(
        ['Members', 'API keys', 'Organizations'],
      );
      expect(await pageScrollsHorizontally(page)).toBe(false);
    });
  });
}

test.describe('390px wide', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the menu button opens and closes the navigation with the keyboard', async ({ page }) => {
    await openRoute(page, '/');
    const button = menu(page);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(nav(page).getByRole('link')).toHaveCount(0);
    await page.keyboard.press('Tab'); // skip link
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const controlled = await button.getAttribute('aria-controls');
    await expect(page.locator(`[id="${controlled ?? ''}"]`)).toBeVisible();
    // Tab moves into the opened links; Escape closes and returns focus to the button.
    await page.keyboard.press('Tab');
    await expect(nav(page).getByRole('link', { name: 'Overview' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
    await expect(nav(page).getByRole('link')).toHaveCount(0);
  });

  test('every destination is reachable from the menu, which closes after a choice', async ({
    page,
  }) => {
    await openRoute(page, '/');
    for (const route of STATIC_ROUTES) {
      await menu(page).click();
      const links = nav(page).getByRole('link');
      await expect(links).toHaveCount(STATIC_ROUTES.length);
      const link = links.nth(STATIC_ROUTES.indexOf(route));
      await link.scrollIntoViewIfNeeded();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`#${route.path}$`));
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
      await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(menu(page)).toBeFocused();
      expect(await pageScrollsHorizontally(page)).toBe(false);
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe ${theme}: the opened menu`, async ({ page }, testInfo) => {
      await presetTheme(page, theme);
      await openRoute(page, '/members');
      await menu(page).click();
      await expect(nav(page).getByRole('link', { name: 'Members' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(blocking(await scan(page, testInfo, `menu-${theme}`))).toEqual([]);
    });
  }
});
