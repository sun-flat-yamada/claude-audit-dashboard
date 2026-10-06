import type { ChangeClass } from '@claude-audit/core/contracts';
import { openRoute } from '../support/app';
import {
  baseSelect,
  hashUrl,
  CHANGE_LABEL,
  chip,
  compareUrl,
  coverageTable,
  expectedChipCounts,
  expectedDiff,
  kpiTable,
  loadCompare,
  pointText,
  ruleCell,
  ruleRows,
  RULE_COLUMNS,
  ruleTable,
  searchBox,
  swapButton,
  targetSelect,
  type CompareData,
} from '../support/compare';
import { expect, test } from '../support/test';

// F-015 compare view on the profiles with several time points: "sample" (the three-point synthetic
// tenant) and "optional-sources" (the same points, the optional sources on at the newest one).
// Every expectation is derived from the published compare files with the core diff function.
const PROFILES = ['sample', 'optional-sources'];

const minus = (n: number): string => (n < 0 ? `−${Math.abs(n)}` : n > 0 ? `+${n}` : '0');

test.describe('compare view with several time points', () => {
  let data: CompareData;
  test.beforeEach(async ({ request }, info) => {
    test.skip(!PROFILES.includes(info.project.name), 'runs on the multi-point profiles');
    data = await loadCompare(request);
    expect(data.ids.length, 'the profile has at least three time points').toBeGreaterThanOrEqual(3);
  });

  test('defaults to the newest point as target and the one before it as base', async ({ page }) => {
    const [newest, previous] = data.ids as [string, string];
    await openRoute(page, '/compare');
    await expect(targetSelect(page)).toHaveValue(newest);
    await expect(baseSelect(page)).toHaveValue(previous);
    const options = await baseSelect(page).locator('option').all();
    expect(await Promise.all(options.map((o) => o.getAttribute('value')))).toEqual(data.ids);
    for (const [i, id] of data.ids.entries()) {
      const score = data.index.points.find((p) => p.id === id)?.score;
      await expect(options[i]).toHaveText(`${pointText(id)} · score ${score}`);
    }
    const diff = expectedDiff(data, previous, newest);
    const summary = page.getByRole('definition').filter({ hasText: '→' });
    await expect(summary.first()).toContainText(
      `${diff.score.base} → ${diff.score.target} (${minus(diff.score.delta)})`,
    );
    await expect(
      page.getByText(
        `${diff.score.baseAssessed} of ${diff.score.baseTotal} → ${diff.score.targetAssessed} of ${diff.score.targetTotal} (${minus(diff.score.assessedDelta)})`,
      ),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the link on the overview opens the comparison of the last two points', async ({ page }) => {
    await openRoute(page, '/');
    await page.getByRole('link', { name: 'Compare the last two time points' }).click();
    await expect(page).toHaveURL(/#\/compare$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Compare time points' }),
    ).toBeVisible();
    await expect(targetSelect(page)).toHaveValue(data.ids[0] ?? '');
    await expect(ruleTable(page)).toBeVisible();
  });

  test('the selectors choose other points and the hash follows without a history entry', async ({
    page,
  }) => {
    const [t3, , t1] = data.ids as [string, string, string];
    await openRoute(page, '/compare');
    const entries = await page.evaluate(() => window.history.length);
    await baseSelect(page).selectOption(t1);
    await expect(page).toHaveURL(hashUrl(compareUrl(t1, t3)));
    expect(await page.evaluate(() => window.history.length)).toBe(entries);
    const diff = expectedDiff(data, t1, t3);
    expect((await ruleRows(page)).map((r) => r.id)).toEqual(diff.rules.changes.map((r) => r.id));
    await targetSelect(page).selectOption(data.ids[1] ?? '');
    await expect(page).toHaveURL(hashUrl(compareUrl(t1, data.ids[1] ?? '')));
    expect((await ruleRows(page)).map((r) => r.id)).toEqual(
      expectedDiff(data, t1, data.ids[1] ?? '').rules.changes.map((r) => r.id),
    );
  });

  test('the swap button exchanges base and target and turns the changes around', async ({
    page,
  }) => {
    const [t3, t2] = data.ids as [string, string];
    await openRoute(page, '/compare');
    const before = await ruleRows(page);
    await swapButton(page).click();
    await expect(baseSelect(page)).toHaveValue(t3);
    await expect(targetSelect(page)).toHaveValue(t2);
    await expect(page).toHaveURL(hashUrl(compareUrl(t3, t2)));
    const reversed = expectedDiff(data, t3, t2);
    expect((await ruleRows(page)).map((r) => r.id)).toEqual(
      reversed.rules.changes.map((r) => r.id),
    );
    const swapped = await ruleRows(page);
    const flip: Record<string, string> = { Regressed: 'Improved', Improved: 'Regressed' };
    for (const row of before.filter((r) => flip[r.change])) {
      expect(swapped.find((s) => s.id === row.id)?.change, `${row.id} after the swap`).toBe(
        flip[row.change],
      );
    }
    await swapButton(page).click();
    await expect(baseSelect(page)).toHaveValue(t2);
    await expect(targetSelect(page)).toHaveValue(t3);
  });

  test('a deep link opens that pair and survives a reload', async ({ page }) => {
    const [t3, , t1] = data.ids as [string, string, string];
    await page.goto(`./#${compareUrl(t1, t3)}`);
    await expect(ruleTable(page)).toBeVisible();
    const rows = await ruleRows(page);
    await page.reload();
    await expect(ruleTable(page)).toBeVisible();
    await expect(baseSelect(page)).toHaveValue(t1);
    await expect(targetSelect(page)).toHaveValue(t3);
    expect(await ruleRows(page)).toEqual(rows);
    expect(rows.map((r) => r.id)).toEqual(
      expectedDiff(data, t1, t3).rules.changes.map((r) => r.id),
    );
  });

  test('back and forward move between the pairs of the history', async ({ page }) => {
    const [t3, t2, t1] = data.ids as [string, string, string];
    await page.goto(`./#${compareUrl(t2, t3)}`);
    await expect(baseSelect(page)).toHaveValue(t2);
    await page.goto(`./#${compareUrl(t1, t2)}`);
    await expect(baseSelect(page)).toHaveValue(t1);
    await expect(targetSelect(page)).toHaveValue(t2);
    await page.goBack();
    await expect(baseSelect(page)).toHaveValue(t2);
    await expect(targetSelect(page)).toHaveValue(t3);
    await page.goForward();
    await expect(baseSelect(page)).toHaveValue(t1);
    await expect(targetSelect(page)).toHaveValue(t2);
  });

  test('back and forward also work across screens and keep the selection', async ({ page }) => {
    const [t3, , t1] = data.ids as [string, string, string];
    await openRoute(page, '/');
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Compare' })
      .click();
    await baseSelect(page).selectOption(t1);
    await expect(page).toHaveURL(hashUrl(compareUrl(t1, t3)));
    await page.goBack();
    await expect(page).toHaveURL(/#\/$/);
    await expect(
      page.getByRole('heading', { level: 1, name: /Claude Enterprise Audit/ }),
    ).toBeVisible();
    await page.goForward();
    await expect(baseSelect(page)).toHaveValue(t1);
    await expect(targetSelect(page)).toHaveValue(t3);
  });

  test('rule changes are ordered regressed first and show icon, label and colour', async ({
    page,
  }) => {
    const [t3, , t1] = data.ids as [string, string, string];
    for (const [base, target] of [
      [data.ids[1] ?? '', t3],
      [t1, t3],
    ] as const) {
      await page.goto(`./#${compareUrl(base, target)}`);
      await expect(ruleTable(page)).toBeVisible();
      const diff = expectedDiff(data, base, target);
      const rows = await ruleRows(page);
      expect(rows.map((r) => r.id)).toEqual(diff.rules.changes.map((r) => r.id));
      const regressed = diff.rules.counts.regressed;
      expect(regressed).toBeGreaterThan(0);
      expect(rows.slice(0, regressed).map((r) => r.change)).toEqual(
        Array(regressed).fill('Regressed'),
      );
      expect(rows.slice(regressed).some((r) => r.change === 'Regressed')).toBe(false);
    }
    await page.goto(`./#${compareUrl(data.ids[1] ?? '', t3)}`);
    const tableRows = ruleTable(page).locator('tbody tr');
    await expect(ruleTable(page).getByRole('columnheader')).toHaveText([...RULE_COLUMNS]);
    const colours: Record<string, [string, string]> = {
      Regressed: ['▼', 'var(--status-critical)'],
      Improved: ['▲', 'var(--status-good)'],
      Added: ['+', 'var(--status-neutral)'],
    };
    for (const [label, [icon, colour]] of Object.entries(colours)) {
      const changeColumn = `td:nth-child(${RULE_COLUMNS.indexOf('Change') + 1})`;
      const cell = tableRows
        .filter({ has: page.locator(changeColumn, { hasText: label }) })
        .first()
        .locator(changeColumn);
      await expect(cell, `a "${label}" change exists`).toBeVisible();
      const badge = cell.locator('span[aria-hidden="true"]');
      await expect(badge).toHaveText(icon);
      await expect(badge).toHaveAttribute('style', new RegExp(colour.replace(/[()]/g, '\\$&')));
      const background = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(background).not.toBe('rgba(0, 0, 0, 0)');
    }
    // Base and target statuses carry their own icon and label, and a rule added at the target has
    // "Not present" on the base side.
    const added = tableRows.filter({ hasText: 'Not present' }).first();
    await expect(added).toContainText('Added');
    const regressedRow = tableRows.first();
    await expect(ruleCell(regressedRow, 'Base')).toContainText(/Pass|Review|Fail|Warning/);
    await expect(ruleCell(regressedRow, 'Target')).toContainText('Fail');
  });

  test('the change chips show the counts and filter the table', async ({ page }) => {
    const [t3, t2] = data.ids as [string, string];
    await page.goto(`./#${compareUrl(t2, t3)}`);
    await expect(ruleTable(page)).toBeVisible();
    const diff = expectedDiff(data, t2, t3);
    const counts = expectedChipCounts(diff);
    for (const key of ['all', ...Object.keys(CHANGE_LABEL)] as (ChangeClass | 'all')[]) {
      await expect(chip(page, key)).toContainText(String(counts[key]));
    }
    await expect(chip(page, 'all')).toHaveAttribute('aria-pressed', 'true');
    for (const key of Object.keys(CHANGE_LABEL) as ChangeClass[]) {
      await chip(page, key).click();
      await expect(chip(page, key)).toHaveAttribute('aria-pressed', 'true');
      await expect(chip(page, 'all')).toHaveAttribute('aria-pressed', 'false');
      const n = counts[key];
      await expect(page.getByRole('status').filter({ hasText: 'shown' })).toHaveText(
        `${n} ${n === 1 ? 'rule' : 'rules'} shown`,
      );
      if (n === 0) {
        await expect(page.getByText('No rules match the current filter and search.')).toBeVisible();
        await expect(ruleTable(page)).toHaveCount(0);
      } else {
        const rows = await ruleRows(page);
        expect(rows).toHaveLength(n);
        expect(rows.every((r) => r.change === CHANGE_LABEL[key])).toBe(true);
      }
    }
    await chip(page, 'all').click();
    expect(await ruleRows(page)).toHaveLength(counts.all);
  });

  test('the search narrows the rules by id, name, category and severity', async ({ page }) => {
    const [t3, t2] = data.ids as [string, string];
    await page.goto(`./#${compareUrl(t2, t3)}`);
    await expect(ruleTable(page)).toBeVisible();
    const diff = expectedDiff(data, t2, t3);
    const first = diff.rules.changes[0];
    if (!first) throw new Error('the sample pair has rule changes');
    await searchBox(page).fill(first.id.toLowerCase());
    const needle = first.id.toLowerCase();
    const expected = diff.rules.changes.filter((r) =>
      [r.id, r.name, r.category, r.severity].some((v) => v.toLowerCase().includes(needle)),
    );
    expect((await ruleRows(page)).map((r) => r.id)).toEqual(expected.map((r) => r.id));
    await searchBox(page).fill(first.name.toUpperCase());
    expect((await ruleRows(page)).map((r) => r.id)).toContain(first.id);
    await searchBox(page).fill('zzzz-no-such-rule');
    await expect(page.getByText('No rules match the current filter and search.')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'shown' })).toHaveText('0 rules shown');
    await searchBox(page).fill('');
    expect(await ruleRows(page)).toHaveLength(diff.rules.changes.length);
    // The search combines with a chip.
    await chip(page, 'regressed').click();
    await searchBox(page).fill(first.id);
    const both = diff.rules.changes.filter((r) => r.change === 'regressed' && r.id === first.id);
    expect(await ruleRows(page)).toHaveLength(both.length);
  });

  test('data coverage changes list each dataset with its states and item counts', async ({
    page,
  }) => {
    const [, t2, t1] = data.ids as [string, string, string];
    const label: Record<string, string> = {
      ok: 'Collected',
      unavailable: 'Unavailable',
      error: 'Error',
    };
    let shown = 0;
    for (const [base, target] of [
      [t1, t2],
      [t2, data.ids[0] ?? ''],
      [t1, data.ids[0] ?? ''],
    ] as const) {
      const diff = expectedDiff(data, base, target);
      await page.goto(`./#${compareUrl(base, target)}`);
      if (diff.coverage.changes.length === 0) {
        await expect(page.getByText('No dataset changed its collection state.')).toBeVisible();
        continue;
      }
      const rows = coverageTable(page).locator('tbody tr');
      await expect(rows).toHaveCount(diff.coverage.changes.length);
      for (const [i, change] of diff.coverage.changes.entries()) {
        const row = rows.nth(i);
        await expect(row.locator('th')).toHaveText(change.dataset);
        await expect(row.locator('td').nth(0)).toContainText(
          change.from ? (label[change.from] ?? '') : 'Not present',
        );
        await expect(row.locator('td').nth(1)).toContainText(
          change.to ? (label[change.to] ?? '') : 'Not present',
        );
        await expect(row.locator('td').nth(2)).toContainText(CHANGE_LABEL[change.change]);
        shown += 1;
      }
    }
    expect(shown, 'the sample changes the collection state of datasets').toBeGreaterThan(0);
  });

  test('the optional-source datasets appear as coverage changes at the newest point', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'optional-sources', 'optional-sources profile only');
    const [t3, t2] = data.ids as [string, string];
    await page.goto(`./#${compareUrl(t2, t3)}`);
    const row = coverageTable(page)
      .locator('tbody tr')
      .filter({
        has: page.getByRole('rowheader', { name: 'consoleWorkspaces', exact: true }),
      });
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(0)).toContainText(/Not present|Unavailable/);
    await expect(row.locator('td').nth(1)).toContainText('Collected');
  });

  test('the key figures show both points and the signed change', async ({ page }) => {
    const [, t2, t1] = data.ids as [string, string, string];
    await page.goto(`./#${compareUrl(t1, t2)}`);
    const diff = expectedDiff(data, t1, t2);
    const rows = kpiTable(page).locator('tbody tr');
    await expect(rows).toHaveCount(diff.kpis.length);
    for (const [i, kpi] of diff.kpis.entries()) {
      const row = rows.nth(i);
      await expect(row.locator('th')).toHaveText(kpi.label);
      if (kpi.unit === 'count' && kpi.base !== null && kpi.target !== null && kpi.delta !== null) {
        const cells = row.locator('td');
        await expect(cells.nth(0)).toHaveText(kpi.base.toLocaleString('en-US'));
        await expect(cells.nth(1)).toHaveText(kpi.target.toLocaleString('en-US'));
        await expect(cells.nth(2)).toHaveText(
          kpi.delta === 0
            ? '0'
            : minus(kpi.delta).replace(
                /^([+−])(\d+)$/,
                (_, s, d) => `${s}${Number(d).toLocaleString('en-US')}`,
              ),
        );
      }
    }
    // Members rose from the first to the second point of the sample.
    const members = rows.filter({ has: page.getByRole('rowheader', { name: 'Members' }) });
    await expect(members.locator('td').nth(2)).toHaveText(/^\+/);
    await expect(rows.filter({ hasText: 'Month-to-date cost' }).locator('td').nth(0)).toContainText(
      '$',
    );
  });

  test('an unknown id is reported without a crash and the selectors stay usable', async ({
    page,
  }) => {
    const [t3, t2] = data.ids as [string, string];
    await page.goto(`./#/compare?base=nope&target=${t3}`);
    await expect(page.getByRole('alert')).toContainText(
      'The base time point "nope" is not in the list of comparable points.',
    );
    await expect(ruleTable(page)).toHaveCount(0);
    await expect(baseSelect(page)).toHaveValue('');
    await baseSelect(page).selectOption(t2);
    await expect(ruleTable(page)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the same point on both sides says there is nothing to compare', async ({ page }) => {
    const t3 = data.ids[0] ?? '';
    await page.goto(`./#${compareUrl(t3, t3)}`);
    await expect(
      page.getByText('Base and target are the same time point, so there is nothing to compare.'),
    ).toBeVisible();
    await expect(page.getByText('No differences between these two time points.')).toBeVisible();
    await expect(page.getByText('No rule changed between these time points.')).toBeVisible();
    await expect(page.getByText('No dataset changed its collection state.')).toBeVisible();
  });

  test('a listed point whose file is missing or broken is explained', async ({ page }) => {
    const [t3, t2] = data.ids as [string, string];
    await page.route(`**/data/detail/compare/${t2}.json`, (route) =>
      route.fulfill({ status: 404, body: '{}' }),
    );
    await page.goto('./#/compare');
    await expect(page.getByRole('status')).toContainText('is listed but not published');
    await page.unroute(`**/data/detail/compare/${t2}.json`);
    await page.route(`**/data/detail/compare/${t3}.json`, (route) =>
      route.fulfill({ status: 500, body: '{}' }),
    );
    await page.goto(`./#${compareUrl(t2, t3)}`);
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Failed to load the summary of');
  });
});
