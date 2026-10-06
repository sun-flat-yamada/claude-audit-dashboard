import type { Page, TestInfo } from '@playwright/test';
import { blocking, openRoute, presetTheme, scan, type Theme } from '../support/app';
import {
  baseSelect,
  chip,
  compareUrl,
  loadCompare,
  noPageScroll,
  searchBox,
  type CompareData,
} from '../support/compare';
import { expect, test } from '../support/test';

// axe WCAG 2.1 AA (wcag2a, wcag2aa): critical and serious must be 0 on /compare in light and
// dark and at 390px, including the states the plain route scan does not open: a filter applied,
// an export done, the unchanged rules, an empty search result, the focused archived option.
const MULTI = ['sample', 'optional-sources'];

async function expectClean(page: Page, info: TestInfo, name: string): Promise<void> {
  expect(blocking(await scan(page, info, name)), `axe ${name}`).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`compare view, axe, ${theme} theme`, () => {
    let data: CompareData;
    test.beforeEach(async ({ page, request }, info) => {
      await presetTheme(page, theme as Theme);
      // The profiles without a comparison publish no points (unavailable has no file at all).
      if ([...MULTI, 'compare-archived'].includes(info.project.name)) {
        data = await loadCompare(request);
      }
    });

    test('the default comparison, a far pair and the same-point notice', async ({ page }, info) => {
      test.skip(!MULTI.includes(info.project.name), 'runs on the multi-point profiles');
      const [t3, , t1] = data.ids as [string, string, string];
      await openRoute(page, '/compare');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectClean(page, info, `${theme}-default`);
      await page.goto(`./#${compareUrl(t1, t3)}`);
      await expect(page.getByRole('table', { name: 'Rule changes', exact: true })).toBeVisible();
      await expectClean(page, info, `${theme}-far-pair`);
      await page.goto(`./#${compareUrl(t3, t3)}`);
      await expect(page.getByText(/same time point/)).toBeVisible();
      await expectClean(page, info, `${theme}-same-point`);
    });

    test('a regression filter applied, then the unchanged rules and an empty search', async ({
      page,
    }, info) => {
      test.skip(!MULTI.includes(info.project.name), 'runs on the multi-point profiles');
      await openRoute(page, '/compare');
      await chip(page, 'regressed').click();
      await expect(chip(page, 'regressed')).toHaveAttribute('aria-pressed', 'true');
      await expectClean(page, info, `${theme}-regressed-filter`);
      await chip(page, 'unchanged').click();
      await expectClean(page, info, `${theme}-unchanged`);
      await searchBox(page).fill('zzzz-no-such-rule');
      await expect(page.getByText('No rules match the current filter and search.')).toBeVisible();
      await expectClean(page, info, `${theme}-empty-search`);
    });

    test('after an export and with a focused control', async ({ page }, info) => {
      test.skip(!MULTI.includes(info.project.name), 'runs on the multi-point profiles');
      await openRoute(page, '/compare');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export Markdown' }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/^time-point-diff-.*\.md$/);
      await expectClean(page, info, `${theme}-after-export`);
      await baseSelect(page).focus();
      await expectClean(page, info, `${theme}-focused-select`);
      await chip(page, 'improved').focus();
      await expectClean(page, info, `${theme}-focused-chip`);
    });

    test('archived points: the disabled options, the guide and the focused selector', async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'compare-archived', 'runs on the compare-archived profile');
      await openRoute(page, '/compare');
      await expect(
        page.getByRole('heading', { level: 2, name: 'Archived time points' }),
      ).toBeVisible();
      await expectClean(page, info, `${theme}-archived`);
      await baseSelect(page).focus();
      await page.keyboard.press('ArrowDown');
      await expectClean(page, info, `${theme}-archived-focused`);
      const archived = data.index.points.find((p) => p.state === 'archived')?.id ?? '';
      await page.goto(`./#/compare?base=${archived}&target=${data.ids[0]}`);
      await expect(page.getByRole('alert')).toBeVisible();
      await expectClean(page, info, `${theme}-archived-refused`);
    });

    test('the single-point, empty and not-published guidance', async ({ page }, info) => {
      test.skip(
        !['fixtures', 'empty', 'unavailable'].includes(info.project.name),
        'runs on the profiles without a comparison',
      );
      await openRoute(page, '/compare');
      await expect(page.getByRole('status').first()).toBeVisible();
      await expectClean(page, info, `${theme}-${info.project.name}-guidance`);
    });
  });
}

test.describe('compare view on a phone-sized screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('no horizontal page scroll and axe clean in the states of the view', async ({
    page,
    request,
  }, info) => {
    test.skip(!MULTI.includes(info.project.name), 'runs on the multi-point profiles');
    const data = await loadCompare(request);
    const [t3, , t1] = data.ids as [string, string, string];
    await openRoute(page, '/compare');
    expect(await noPageScroll(page)).toBe(true);
    await expectClean(page, info, '390-default');
    await page.goto(`./#${compareUrl(t1, t3)}`);
    await expect(page.getByRole('table', { name: 'Rule changes', exact: true })).toBeVisible();
    expect(await noPageScroll(page)).toBe(true);
    await chip(page, 'regressed').click();
    expect(await noPageScroll(page)).toBe(true);
    await expectClean(page, info, '390-regressed');
    await chip(page, 'unchanged').click();
    expect(await noPageScroll(page)).toBe(true);
    await page.getByRole('button', { name: 'Export JSON' }).click();
    await expectClean(page, info, '390-after-export');
    await page.goto(`./#${compareUrl(t3, t3)}`);
    expect(await noPageScroll(page)).toBe(true);
  });

  test('archived guide and guidance notices fit the screen', async ({ page }, info) => {
    test.skip(
      !['compare-archived', 'fixtures', 'empty', 'unavailable'].includes(info.project.name),
      'runs on the profiles with notices',
    );
    await openRoute(page, '/compare');
    expect(await noPageScroll(page)).toBe(true);
    await expectClean(page, info, `390-${info.project.name}`);
    if (info.project.name === 'compare-archived') {
      await baseSelect(page).focus();
      expect(await noPageScroll(page)).toBe(true);
    }
  });
});
