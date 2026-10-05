import { blocking, openRoute, presetTheme, scan } from '../support/app';
import { discoverIds, SCREENS } from '../support/routes';
import { expect, test } from '../support/test';

// WCAG 2.1 AA (wcag2a, wcag2aa) on every route x light / dark; critical and serious must be 0.
for (const theme of ['light', 'dark'] as const) {
  for (const screen of SCREENS) {
    test(`axe ${theme}: ${screen.name}`, async ({ page, request }, testInfo) => {
      await presetTheme(page, theme);
      await openRoute(page, screen.path(await discoverIds(request)));
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const violations = await scan(page, testInfo, `${theme}${screen.name.replaceAll('/', '_')}`);
      expect(blocking(violations), 'critical / serious axe violations').toEqual([]);
    });
  }
}
