import {
  CHANGE_CLASSES,
  compareIndexSchema,
  diffTimePoints,
  timePointSummarySchema,
  type ChangeClass,
  type CompareIndex,
  type TimePointDiff,
  type TimePointSummary,
} from '@claude-audit/core/contracts';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { readData } from './app';
import { expect } from './test';

/** The compare data a profile publishes: the index and every summary file it lists. */
export interface CompareData {
  index: CompareIndex;
  /** Points with a summary file, newest first. */
  ids: string[];
  summaries: Map<string, TimePointSummary>;
}

export async function loadCompare(request: APIRequestContext): Promise<CompareData> {
  const index = compareIndexSchema.parse(await readData(request, 'detail/compare/index.json'));
  const ids = index.points.filter((p) => p.state === 'summary').map((p) => p.id);
  const summaries = new Map<string, TimePointSummary>();
  for (const id of ids) {
    summaries.set(
      id,
      timePointSummarySchema.parse(await readData(request, `detail/compare/${id}.json`)),
    );
  }
  return { index, ids, summaries };
}

/** The diff the page must show for a pair (the pure core function on the published files). */
export function expectedDiff(data: CompareData, base: string, target: string): TimePointDiff {
  const b = data.summaries.get(base);
  const t = data.summaries.get(target);
  if (!b || !t) throw new Error(`no summary for ${base} or ${target}`);
  return diffTimePoints(b, t);
}

/** `2026-09-01T12-00-00Z` -> `2026-09-01 12:00 UTC` (the page's option text). */
export const pointText = (id: string): string =>
  id.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-\d{2}Z$/, '$1 $2:$3 UTC');

/** Matches a page URL that ends with the hash route (the `?` of the query is literal). */
export const hashUrl = (route: string): RegExp =>
  new RegExp(`#${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

export const compareUrl = (base: string, target: string): string =>
  `/compare?base=${base}&target=${target}`;

export const baseSelect = (page: Page): Locator => page.getByLabel('Base time point');
export const targetSelect = (page: Page): Locator => page.getByLabel('Target time point');
export const swapButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Swap base and target' });
export const ruleTable = (page: Page): Locator =>
  page.getByRole('table', { name: 'Rule changes', exact: true });
/** Columns of the rule table; `Rule` is the row header, the others are cells. */
export const RULE_COLUMNS = ['Rule', 'Change', 'Name', 'Severity', 'Base', 'Target'] as const;

/** The cell of a rule table row by its column name (not by position). */
export const ruleCell = (row: Locator, column: (typeof RULE_COLUMNS)[number]): Locator =>
  row.locator('td').nth(RULE_COLUMNS.indexOf(column) - 1);

export const coverageTable = (page: Page): Locator =>
  page.getByRole('table', { name: 'Data coverage changes', exact: true });
export const kpiTable = (page: Page): Locator =>
  page.getByRole('table', { name: 'Key figure changes', exact: true });
export const chipGroup = (page: Page): Locator =>
  page.getByRole('group', { name: 'Filter by change' });
export const exportGroup = (page: Page): Locator =>
  page.getByRole('group', { name: 'Export comparison' });
export const searchBox = (page: Page): Locator =>
  page.getByRole('searchbox', { name: 'Search rules' });

export const CHANGE_LABEL: Record<ChangeClass, string> = {
  regressed: 'Regressed',
  improved: 'Improved',
  added: 'Added',
  removed: 'Removed',
  assessed: 'Now assessed',
  unassessed: 'No longer assessed',
  unchanged: 'Unchanged',
};

export const chip = (page: Page, change: ChangeClass | 'all'): Locator =>
  chipGroup(page).getByRole('button', {
    name: new RegExp(`^${change === 'all' ? 'All changes' : CHANGE_LABEL[change]} \\d+$`),
  });

/** Chip counts of a diff: `all` is every changed rule, i.e. everything but `unchanged`. */
export function expectedChipCounts(diff: TimePointDiff): Record<ChangeClass | 'all', number> {
  const counts = diff.rules.counts;
  const changed = CHANGE_CLASSES.filter((c) => c !== 'unchanged').reduce(
    (n, c) => n + counts[c],
    0,
  );
  return { ...counts, all: changed };
}

/**
 * The rows of the rule table (rule id and the label of the Change cell). It waits for the
 * "N rules shown" status of the loaded result first, so it never reads the table while the
 * summaries of a newly chosen pair are still loading.
 */
export async function ruleRows(page: Page): Promise<{ id: string; change: string }[]> {
  const status = page.getByRole('status').filter({ hasText: /^\d+ rules? shown$/ });
  await expect(status).toBeVisible();
  const shown = Number((await status.innerText()).split(' ')[0]);
  await expect(ruleTable(page).locator('tbody tr')).toHaveCount(shown);
  const out: { id: string; change: string }[] = [];
  for (const row of await ruleTable(page).locator('tbody tr').all()) {
    const id = (await row.locator('th').innerText()).trim();
    // The badge is an aria-hidden icon followed by the label; the label is the last line.
    const cell = (await ruleCell(row, 'Change').innerText()).trim();
    out.push({ id, change: cell.split('\n').pop()?.trim() ?? '' });
  }
  return out;
}

/** True when the page itself (not an inner scroll region) scrolls sideways. */
export const noPageScroll = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
