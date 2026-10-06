import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  timePointDiffExport,
  timePointDiffFileName,
  type TimePointExportFormat,
} from '@claude-audit/core/contracts';
import { openRoute } from '../support/app';
import {
  compareUrl,
  hashUrl,
  exportGroup,
  expectedDiff,
  loadCompare,
  type CompareData,
} from '../support/compare';
import { downloadText } from '../support/csv';
import { expect, test } from '../support/test';

// F-015 export: the file saved by the browser equals the core formatter output for the pair on
// screen, and on the sample's three points it equals the collector goldens byte for byte.
const PROFILES = ['sample', 'optional-sources'];
const FORMATS: { format: TimePointExportFormat; button: string }[] = [
  { format: 'md', button: 'Export Markdown' },
  { format: 'csv', button: 'Export CSV' },
  { format: 'json', button: 'Export JSON' },
];

const GOLDEN_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'collector',
  'src',
  'main',
  '__tests__',
  '__golden__',
);
const golden = (pair: string, format: string): string =>
  readFileSync(join(GOLDEN_DIR, `time-point-diff-${pair}.${format}.golden`), 'utf-8');

test.describe('compare export', () => {
  let data: CompareData;
  test.beforeEach(async ({ request }, info) => {
    test.skip(!PROFILES.includes(info.project.name), 'runs on the multi-point profiles');
    data = await loadCompare(request);
  });

  test('offers Markdown, CSV and JSON as buttons of one named group', async ({ page }) => {
    await openRoute(page, '/compare');
    const buttons = exportGroup(page).getByRole('button');
    await expect(buttons).toHaveText(FORMATS.map((f) => f.button));
  });

  for (const { format, button } of FORMATS) {
    test(`${button} downloads the core formatter output for the pair shown`, async ({ page }) => {
      const [t3, , t1] = data.ids as [string, string, string];
      await page.goto(`./#${compareUrl(t1, t3)}`);
      await expect(exportGroup(page)).toBeVisible();
      const diff = expectedDiff(data, t1, t3);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: button }).click(),
      ]);
      expect(download.suggestedFilename()).toBe(timePointDiffFileName(diff, format));
      expect(download.suggestedFilename()).toMatch(
        new RegExp(`^time-point-diff-\\d{8}T\\d{6}Z-\\d{8}T\\d{6}Z\\.${format}$`),
      );
      const text = await downloadText(download);
      expect(text).toBe(timePointDiffExport(diff, format));
    });
  }

  test('the three pairs of the sample equal the collector goldens and have fixed names', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'sample', 'the goldens are built from the public sample');
    const [t3, t2, t1] = data.ids as [string, string, string];
    const pairs = [
      { base: t1, target: t2, golden: 't1-t2', name: '20260901T120000Z-20260915T120000Z' },
      { base: t2, target: t3, golden: 't2-t3', name: '20260915T120000Z-20260929T120000Z' },
      { base: t1, target: t3, golden: 't1-t3', name: '20260901T120000Z-20260929T120000Z' },
    ];
    for (const pair of pairs) {
      await page.goto(`./#${compareUrl(pair.base, pair.target)}`);
      await expect(exportGroup(page)).toBeVisible();
      for (const { format, button } of FORMATS) {
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.getByRole('button', { name: button }).click(),
        ]);
        expect(download.suggestedFilename()).toBe(`time-point-diff-${pair.name}.${format}`);
        expect(await downloadText(download), `${pair.golden}.${format}`).toBe(
          golden(pair.golden, format),
        );
      }
    }
  });

  test('the exported CSV is complete when a filter or a search narrows the screen', async ({
    page,
  }) => {
    const [t3, t2] = data.ids as [string, string];
    await page.goto(`./#${compareUrl(t2, t3)}`);
    await page.getByRole('searchbox', { name: 'Search rules' }).fill('zzzz-no-such-rule');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(await downloadText(download)).toBe(
      timePointDiffExport(expectedDiff(data, t2, t3), 'csv'),
    );
  });

  test('after a swap the file names follow the new direction', async ({ page }) => {
    const [t3, t2] = data.ids as [string, string];
    await page.goto(`./#${compareUrl(t2, t3)}`);
    await page.getByRole('button', { name: 'Swap base and target' }).click();
    await expect(page).toHaveURL(hashUrl(compareUrl(t3, t2)));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export JSON' }).click(),
    ]);
    const diff = expectedDiff(data, t3, t2);
    expect(download.suggestedFilename()).toBe(timePointDiffFileName(diff, 'json'));
    expect(await downloadText(download)).toBe(timePointDiffExport(diff, 'json'));
  });
});
