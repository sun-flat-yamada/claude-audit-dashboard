import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { expect } from './test';

export const THEME_KEY = 'claude-audit-theme';
export type Theme = 'light' | 'dark';

/** Stores the theme choice before the first paint (what the toggle persists). */
export async function presetTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [THEME_KEY, theme],
  );
}

/** Opens a hash route and waits until the app is no longer loading. */
export async function openRoute(page: Page, path: string): Promise<void> {
  await page.goto(`./#${path}`);
  await settled(page);
}

export async function settled(page: Page): Promise<void> {
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByText(/^Loading/)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

export interface AxeSummary {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: string[];
}

/** WCAG 2.1 A and AA scan (the tags of the acceptance criteria); results are attached as JSON. */
export async function scan(page: Page, testInfo: TestInfo, name: string): Promise<AxeSummary[]> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const summary = result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => `${n.target.join(' ')} :: ${n.failureSummary ?? ''}`.slice(0, 400)),
  }));
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify(summary, null, 2),
    contentType: 'application/json',
  });
  return summary;
}

export const blocking = (violations: AxeSummary[]): AxeSummary[] =>
  violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');

/** Reads a published data file of the profile under test (path relative to `data/`). */
export async function readData<T = unknown>(
  request: import('@playwright/test').APIRequestContext,
  path: string,
): Promise<T> {
  const response = await request.get(`data/${path}`);
  expect(response.ok(), `data/${path} is published`).toBe(true);
  return (await response.json()) as T;
}

/** True when the page scrolls horizontally (the page, not a table inside its own container). */
export const pageScrollsHorizontally = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
