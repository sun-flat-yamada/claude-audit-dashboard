import { CHANGE_CLASSES } from '@claude-audit/core/contracts';
import type { Page } from '@playwright/test';
import { openRoute } from '../support/app';
import {
  baseSelect,
  hashUrl,
  chip,
  compareUrl,
  exportGroup,
  expectedDiff,
  ruleTable,
  loadCompare,
  noPageScroll,
  ruleRows,
  searchBox,
  swapButton,
  targetSelect,
  type CompareData,
} from '../support/compare';
import { downloadText } from '../support/csv';
import { expect, test } from '../support/test';

// F-015 compare view operated with the keyboard only (WCAG 2.1.1, 2.4.3, 2.4.7).
const PROFILES = ['sample', 'optional-sources'];
// The chips follow the order of the diff's change classes (most important first).
const CHANGE_CHIPS = CHANGE_CLASSES;

const hasFocusIndicator = (page: Page) =>
  page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return (
      (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
      style.boxShadow !== 'none'
    );
  });

test.describe('compare view, keyboard only', () => {
  let data: CompareData;
  test.beforeEach(async ({ request }, info) => {
    test.skip(!PROFILES.includes(info.project.name), 'runs on the multi-point profiles');
    data = await loadCompare(request);
  });

  test('the skip link leads into the compare content, whose first stops are the selectors', async ({
    page,
  }) => {
    await openRoute(page, '/compare');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
    await expect(page).toHaveURL(/#\/compare$/);
    await page.keyboard.press('Tab');
    await expect(baseSelect(page)).toBeFocused();
  });

  test('focus order in the content: selectors, swap, exports, chips, then the search field', async ({
    page,
  }) => {
    await openRoute(page, '/compare');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const stops = [
      baseSelect(page),
      targetSelect(page),
      swapButton(page),
      page.getByRole('button', { name: 'Export Markdown' }),
      page.getByRole('button', { name: 'Export CSV' }),
      page.getByRole('button', { name: 'Export JSON' }),
      chip(page, 'all'),
      ...CHANGE_CHIPS.map((c) => chip(page, c)),
      searchBox(page),
    ];
    for (const stop of stops) {
      await page.keyboard.press('Tab');
      await expect(stop).toBeFocused();
    }
  });

  test('keyboard focus is visible on the selectors, swap button, chips and export buttons', async ({
    page,
  }) => {
    await openRoute(page, '/compare');
    const targets = [
      baseSelect(page),
      swapButton(page),
      page.getByRole('button', { name: 'Export CSV' }),
      chip(page, 'regressed'),
      searchBox(page),
    ];
    for (const target of targets) {
      await target.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(target).toBeFocused();
      await expect.poll(() => hasFocusIndicator(page)).toBe(true);
    }
  });

  test('the selectors change the pair with the arrow keys', async ({ page }) => {
    const [t3, t2, t1] = data.ids as [string, string, string];
    await openRoute(page, '/compare');
    await baseSelect(page).focus();
    await page.keyboard.press('ArrowDown');
    await expect(baseSelect(page)).toHaveValue(t1);
    await expect(page).toHaveURL(hashUrl(compareUrl(t1, t3)));
    await expect(baseSelect(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(targetSelect(page)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(targetSelect(page)).toHaveValue(t2);
    await expect(page).toHaveURL(hashUrl(compareUrl(t1, t2)));
  });

  test('the swap button works with Enter and Space and keeps focus', async ({ page }) => {
    const [t3, t2] = data.ids as [string, string];
    await openRoute(page, '/compare');
    await swapButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(baseSelect(page)).toHaveValue(t3);
    await expect(targetSelect(page)).toHaveValue(t2);
    await expect(swapButton(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(baseSelect(page)).toHaveValue(t2);
    await expect(targetSelect(page)).toHaveValue(t3);
    await expect(swapButton(page)).toBeFocused();
  });

  test('the change chips toggle with Enter and Space and filter the table', async ({ page }) => {
    await openRoute(page, '/compare');
    await chip(page, 'regressed').focus();
    await page.keyboard.press('Enter');
    await expect(chip(page, 'regressed')).toHaveAttribute('aria-pressed', 'true');
    const regressed = await ruleRows(page);
    expect(regressed.length).toBeGreaterThan(0);
    expect(regressed.every((r) => r.change === 'Regressed')).toBe(true);
    await page.keyboard.press('Tab');
    await expect(chip(page, 'unassessed')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(chip(page, 'unassessed')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, 'regressed')).toHaveAttribute('aria-pressed', 'false');
    await expect(chip(page, 'unassessed')).toBeFocused();
    const [t3, t2] = data.ids as [string, string];
    const count = expectedDiff(data, t2, t3).rules.counts.unassessed;
    await expect(ruleTable(page)).toHaveCount(count > 0 ? 1 : 0);
    const rows = await ruleRows(page);
    expect(rows).toHaveLength(count);
    expect(rows.every((r) => r.change === 'No longer assessed')).toBe(true);
  });

  test('the search field is typed into and cleared with the keyboard', async ({ page }) => {
    await openRoute(page, '/compare');
    await searchBox(page).focus();
    await page.keyboard.type('zzzz');
    await expect(page.getByText('No rules match the current filter and search.')).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await expect(page.getByText('No rules match the current filter and search.')).toHaveCount(0);
    expect((await ruleRows(page)).length).toBeGreaterThan(0);
  });

  test('every export button downloads with Enter and Space', async ({ page }) => {
    await openRoute(page, '/compare');
    const names: string[] = [];
    for (const [label, key] of [
      ['Export Markdown', 'Enter'],
      ['Export CSV', 'Space'],
      ['Export JSON', 'Enter'],
    ] as const) {
      await page.getByRole('button', { name: label }).focus();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.keyboard.press(key),
      ]);
      names.push(download.suggestedFilename());
      expect((await downloadText(download)).length).toBeGreaterThan(100);
      await expect(page.getByRole('button', { name: label })).toBeFocused();
    }
    expect(names.map((n) => n.split('.').pop())).toEqual(['md', 'csv', 'json']);
    await expect(exportGroup(page)).toBeVisible();
  });
});

test.describe('compare view, keyboard only, narrow screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(({}, info) => {
    test.skip(!PROFILES.includes(info.project.name), 'runs on the multi-point profiles');
  });

  test('a wide table scrolls inside a focusable, named region and the page does not', async ({
    page,
  }) => {
    await openRoute(page, '/compare');
    const region = page.getByRole('region', { name: 'Rule changes', exact: true });
    await expect(region).toHaveAttribute('tabindex', '0');
    await region.focus();
    const before = await region.evaluate((el) => el.scrollLeft);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
    expect(await noPageScroll(page)).toBe(true);
  });
});
