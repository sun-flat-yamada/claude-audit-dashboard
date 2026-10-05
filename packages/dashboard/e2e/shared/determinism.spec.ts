import { openRoute, readData } from '../support/app';
import { discoverIds, SCREENS } from '../support/routes';
import { expect, test } from '../support/test';

test.describe('deterministic rendering and data guard', () => {
  test('the profile is synthetic: dashboard.json is labelled "demo", never live', async ({
    request,
  }) => {
    const view = await readData<{ source: string }>(request, 'dashboard.json');
    expect(view.source).toBe('demo');
    // The runner refuses any other data source selection (see playwright.config.ts).
    expect(['', 'sample', 'fixtures']).toContain(process.env.DASHBOARD_DATA_SOURCE ?? '');
  });

  test('locale, time zone and motion preferences are fixed', async ({ page }) => {
    await openRoute(page, '/');
    const env = await page.evaluate(() => ({
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    }));
    expect(env).toEqual({ zone: 'UTC', locale: 'en-US', reduced: true });
  });

  test('no animation runs on any screen (charts draw immediately)', async ({ page, request }) => {
    const ids = await discoverIds(request);
    for (const screen of SCREENS) {
      await openRoute(page, screen.path(ids));
      const running = await page.evaluate(() =>
        document
          .getAnimations()
          .filter(
            (a) =>
              a.playState === 'running' &&
              Number(a.effect?.getComputedTiming().activeDuration ?? 0) > 50,
          )
          .map((a) => a.id || String((a as CSSAnimation).animationName ?? a.constructor.name)),
      );
      expect(running, `running animations on ${screen.name}`).toEqual([]);
    }
  });

  test('works offline: every request of a tour of all screens stays on the preview server', async ({
    page,
    request,
  }) => {
    const origins = new Set<string>();
    page.on('request', (r) => origins.add(new URL(r.url()).origin));
    const ids = await discoverIds(request);
    for (const screen of SCREENS) await openRoute(page, screen.path(ids));
    expect([...origins]).toEqual([new URL(page.url()).origin]);
  });
});
