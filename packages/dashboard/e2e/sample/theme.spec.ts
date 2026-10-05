import type { Page } from '@playwright/test';
import { openRoute, THEME_KEY } from '../support/app';
import { expect, test } from '../support/test';

const LIGHT_PAGE = 'rgb(249, 249, 247)';
const DARK_PAGE = 'rgb(13, 13, 13)';

const group = (page: Page) => page.getByRole('group', { name: 'Theme' });
const pageColor = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const storedTheme = (page: Page) =>
  page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY);

test.describe('F-011 theme toggle', () => {
  test('offers Light, Dark and System; System is the default and follows the OS (light)', async ({
    page,
  }) => {
    await openRoute(page, '/');
    await expect(group(page).getByRole('button')).toHaveText(['Light', 'Dark', 'System']);
    await expect(group(page).getByRole('button', { name: 'System' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
    expect(await pageColor(page)).toBe(LIGHT_PAGE);
  });

  test.describe('OS prefers dark', () => {
    test.use({ colorScheme: 'dark' });
    test('System renders dark; an explicit Light choice wins', async ({ page }) => {
      await openRoute(page, '/');
      expect(await pageColor(page)).toBe(DARK_PAGE);
      await group(page).getByRole('button', { name: 'Light' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      expect(await pageColor(page)).toBe(LIGHT_PAGE);
      await group(page).getByRole('button', { name: 'System' }).click();
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
      expect(await pageColor(page)).toBe(DARK_PAGE);
    });
  });

  test('the choice applies at once, is stored and survives a reload and a new page', async ({
    page,
    context,
  }) => {
    await openRoute(page, '/');
    await group(page).getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(group(page).getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(group(page).getByRole('button', { name: 'Light' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(await pageColor(page)).toBe(DARK_PAGE);
    expect(await storedTheme(page)).toBe('dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(group(page).getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await pageColor(page)).toBe(DARK_PAGE);

    const second = await context.newPage();
    await openRoute(second, '/members');
    await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(group(second).getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('the stored theme is applied before the first paint (no flash)', async ({ page }) => {
    await page.addInitScript((key) => window.localStorage.setItem(key, 'dark'), THEME_KEY);
    await page.goto('./', { waitUntil: 'commit' });
    // The inline script of index.html runs before the bundle: the attribute is there early.
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-theme') === 'dark',
    );
    expect(await pageColor(page)).toBe(DARK_PAGE);
  });

  test('the theme is kept when navigating between screens', async ({ page }) => {
    await openRoute(page, '/');
    await group(page).getByRole('button', { name: 'Dark' }).click();
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Models' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Models' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test.describe('localStorage denied', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          get() {
            throw new DOMException('denied', 'SecurityError');
          },
        });
      });
    });

    test('renders the default theme and the toggle still works for the session', async ({
      page,
    }) => {
      await openRoute(page, '/');
      expect(await pageColor(page)).toBe(LIGHT_PAGE);
      await expect(group(page).getByRole('button', { name: 'System' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await group(page).getByRole('button', { name: 'Dark' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      expect(await pageColor(page)).toBe(DARK_PAGE);
      // Nothing was stored: a reload falls back to the default (and does not throw).
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
      expect(await pageColor(page)).toBe(LIGHT_PAGE);
    });
  });
});
