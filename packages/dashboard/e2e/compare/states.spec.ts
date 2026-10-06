import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detailManifestSchema } from '@claude-audit/core/contracts';
import { openRoute } from '../support/app';
import {
  baseSelect,
  exportGroup,
  loadCompare,
  pointText,
  ruleTable,
  searchBox,
  targetSelect,
} from '../support/compare';
import { expect, test } from '../support/test';

const heading = (page: import('@playwright/test').Page) =>
  page.getByRole('heading', { level: 1, name: 'Compare time points' });

/** The page shows no selector, table, export button or alert (a notice only). */
async function expectNoComparison(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(exportGroup(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test.describe('fixture tenant: a single time point', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'fixtures', 'runs on the fixtures profile');
  });

  test('explains that comparison is not possible and why', async ({ page, request }) => {
    const data = await loadCompare(request);
    expect(data.ids).toHaveLength(1);
    await openRoute(page, '/compare');
    await expect(heading(page)).toBeVisible();
    const notice = page.getByRole('status').filter({ hasText: 'Comparison is not possible yet' });
    await expect(notice).toHaveText(
      'Comparison is not possible yet: only one collected time point has a summary, and two are needed. The next collection adds one.',
    );
    await expectNoComparison(page);
  });

  test('a deep link with ids shows the same guidance instead of a broken page', async ({
    page,
    request,
  }) => {
    const [only] = (await loadCompare(request)).ids;
    await page.goto(`./#/compare?base=${only}&target=${only}`);
    await expect(heading(page)).toBeVisible();
    await expect(page.getByText(/Comparison is not possible yet/)).toBeVisible();
    await expectNoComparison(page);
  });
});

test.describe('detail data not published or not collected', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'unavailable', 'runs on the unavailable profile');
  });

  test('says the comparison data is not published and names the publication switch', async ({
    page,
  }) => {
    await openRoute(page, '/compare');
    await expect(heading(page)).toBeVisible();
    const notice = page
      .getByRole('status')
      .filter({ hasText: 'Comparison data is not published.' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('PAGES_DETAIL_DATA');
    await expectNoComparison(page);
  });

  test('says the data was not collected when the manifest lists it as unavailable', async ({
    page,
  }) => {
    // The manifest of the committed sample with its compare entry marked unavailable (a pipeline
    // without a judged snapshot); validated against the published contract.
    const manifest = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', '..', 'data', 'sample', 'detail', 'index.json'),
        'utf-8',
      ),
    ) as { files: { kind: string }[] };
    const patched = detailManifestSchema.parse({
      ...manifest,
      files: manifest.files.map((f) =>
        f.kind === 'compare'
          ? { ...f, status: 'unavailable', reason: 'no judged snapshot', count: null }
          : f,
      ),
    });
    await page.route('**/data/detail/index.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(patched),
      }),
    );
    await openRoute(page, '/compare');
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Comparison data was not collected (no judged snapshot).' }),
    ).toBeVisible();
    await expectNoComparison(page);
  });

  test('a deep link with ids does not crash', async ({ page }) => {
    await page.goto('./#/compare?base=2026-09-01T12-00-00Z&target=2026-09-29T12-00-00Z');
    await expect(heading(page)).toBeVisible();
    await expect(page.getByText('Comparison data is not published.')).toBeVisible();
    await expectNoComparison(page);
  });
});

test.describe('detail files without rows', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'empty', 'runs on the empty profile');
  });

  test('an index without points says no time point has a summary', async ({ page, request }) => {
    expect((await loadCompare(request)).ids).toEqual([]);
    await openRoute(page, '/compare');
    await expect(
      page.getByText(
        'Comparison is not possible yet: no collected time point has a summary, and two are needed. The next collection adds one.',
      ),
    ).toBeVisible();
    await expectNoComparison(page);
  });
});

test.describe('archived time points without a summary', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'compare-archived', 'runs on the compare-archived profile');
  });

  test('lists archived points as disabled options with the reason', async ({ page, request }) => {
    const { index, ids } = await loadCompare(request);
    const archived = index.points.filter((p) => p.state === 'archived').map((p) => p.id);
    expect(archived).toHaveLength(3);
    await openRoute(page, '/compare');
    for (const select of [baseSelect(page), targetSelect(page)]) {
      const options = select.locator('option');
      await expect(options).toHaveCount(index.points.length);
      // Newest first, archived points interleaved by their ids.
      expect(
        await options.evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)),
      ).toEqual(index.points.map((p) => p.id));
      for (const id of archived) {
        const option = select.locator(`option[value="${id}"]`);
        await expect(option).toHaveJSProperty('disabled', true);
        await expect(option).toHaveText(`${pointText(id)} (archived, no summary)`);
      }
      for (const id of ids)
        await expect(select.locator(`option[value="${id}"]`)).toHaveJSProperty('disabled', false);
    }
    // The default selection skips them: newest vs the previous point with a summary.
    await expect(targetSelect(page)).toHaveValue(ids[0] ?? '');
    await expect(baseSelect(page)).toHaveValue(ids[1] ?? '');
    await expect(ruleTable(page)).toBeVisible();
  });

  test('the guide names the real restore and build commands and the archived ids', async ({
    page,
    request,
  }) => {
    const { index } = await loadCompare(request);
    const archived = index.points.filter((p) => p.state === 'archived').map((p) => p.id);
    await openRoute(page, '/compare');
    const card = page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: 'Archived time points' }),
    });
    await expect(card).toContainText(
      '3 archived points have no summary and cannot be selected yet.',
    );
    await expect(card).toContainText(
      'Bring a snapshot back with pnpm cli restore <id>, then write its summary with pnpm build:detail --snapshot <id>. It is selectable after the next publication.',
    );
    await expect(card.locator('code')).toHaveText([
      'pnpm cli restore <id>',
      'pnpm build:detail --snapshot <id>',
    ]);
    await expect(card.getByRole('listitem')).toHaveText(archived.map(pointText));
  });

  test('an archived id in the link is refused with the restore advice, and the page recovers', async ({
    page,
    request,
  }) => {
    const { index, ids } = await loadCompare(request);
    const archived = index.points.find((p) => p.state === 'archived')?.id ?? '';
    await page.goto(`./#/compare?base=${archived}&target=${ids[0]}`);
    await expect(page.getByRole('alert')).toHaveText(
      `The base time point ${pointText(archived)} is archived without a summary: restore it first (see below).`,
    );
    await expect(ruleTable(page)).toHaveCount(0);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Archived time points' }),
    ).toBeVisible();
    await baseSelect(page).selectOption(ids[2] ?? '');
    await expect(ruleTable(page)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    // Both sides archived: two messages.
    await page.goto(`./#/compare?base=${archived}&target=${archived}`);
    await expect(page.getByRole('alert')).toHaveCount(2);
  });

  test('the selectors never pick an archived point with the keyboard', async ({
    page,
    request,
  }) => {
    const { index, ids } = await loadCompare(request);
    const archived = index.points.filter((p) => p.state === 'archived').map((p) => p.id);
    await openRoute(page, '/compare');
    await baseSelect(page).focus();
    for (let i = 0; i < index.points.length + 2; i += 1) {
      await page.keyboard.press('ArrowDown');
      const value = await baseSelect(page).inputValue();
      expect(archived).not.toContain(value);
      expect(ids).toContain(value);
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(searchBox(page)).toBeVisible();
  });
});
