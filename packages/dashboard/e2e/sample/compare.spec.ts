import type { Page } from '@playwright/test';
import { openRoute, pageScrollsHorizontally, readData } from '../support/app';
import { expect, test } from '../support/test';

// F-015 follow-up (#117): the compare tables stay readable on a phone. The page never scrolls
// sideways, the wide tables scroll inside their own region and no word is broken in the middle.

interface CompareIndex {
  points: { id: string; state: string }[];
}

const TABLES = ['Rule changes', 'Data coverage changes', 'Key figure changes'];

/** Words of the table's text (split at spaces and hyphens) laid out on more than one line. */
const brokenWords = (page: Page, name: string): Promise<string[]> =>
  page.getByRole('table', { name }).evaluate((table) => {
    const broken: string[] = [];
    const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (const match of text.matchAll(/[^\s-]+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const lines = [...range.getClientRects()].filter((r) => r.width > 0);
        if (lines.length > 1) broken.push(match[0]);
      }
    }
    return broken;
  });

async function expectReadableTables(page: Page): Promise<void> {
  await expect(page.getByRole('table', { name: 'Rule changes' })).toBeVisible();
  expect(await pageScrollsHorizontally(page)).toBe(false);
  for (const name of TABLES) {
    if ((await page.getByRole('table', { name }).count()) === 0) continue;
    expect(await brokenWords(page, name), `${name}: words broken across lines`).toEqual([]);
  }
  // The rule table is wider than the phone, so its own region scrolls (and is keyboard reachable).
  const region = page.getByRole('region', { name: 'Rule changes' });
  await expect(region).toBeVisible();
  expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(
    page.getByRole('table', { name: 'Rule changes' }).getByRole('columnheader'),
  ).toHaveText(['Rule', 'Change', 'Name', 'Severity', 'Base', 'Target']);
}

test.describe('compare at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('default selection: no page scroll, tables scroll in their region', async ({ page }) => {
    await openRoute(page, '/compare');
    await expectReadableTables(page);
  });

  test('picked base and target: no page scroll, no broken words', async ({ page, request }) => {
    const index = await readData<CompareIndex>(request, 'detail/compare/index.json');
    const ids = index.points.filter((p) => p.state === 'summary').map((p) => p.id);
    const [newest, oldest] = [ids[0] ?? '', ids.at(-1) ?? ''];
    await openRoute(page, '/compare');
    await page.getByLabel('Base time point').selectOption(oldest);
    await page.getByLabel('Target time point').selectOption(newest);
    await expect(page).toHaveURL(new RegExp(`base=${oldest}&target=${newest}`));
    await expectReadableTables(page);
  });

  test('only a base in the hash picks the next newest point as target', async ({
    page,
    request,
  }) => {
    const index = await readData<CompareIndex>(request, 'detail/compare/index.json');
    const ids = index.points.filter((p) => p.state === 'summary').map((p) => p.id);
    await openRoute(page, `/compare?base=${ids[0] ?? ''}`);
    await expect(page.getByLabel('Target time point')).toHaveValue(ids[1] ?? '');
    await expect(page.getByText(/same time point/)).toHaveCount(0);
  });
});
