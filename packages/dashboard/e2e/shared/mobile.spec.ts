import { openRoute, pageScrollsHorizontally } from '../support/app';
import { discoverIds, SCREENS } from '../support/routes';
import { expect, test } from '../support/test';

// 390 x 844 (phone): the page itself never scrolls sideways; wide tables scroll inside their own box.
test.use({ viewport: { width: 390, height: 844 } });

for (const screen of SCREENS) {
  test(`390px: no horizontal page scroll on ${screen.name}`, async ({ page, request }) => {
    await openRoute(page, screen.path(await discoverIds(request)));
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    expect(await pageScrollsHorizontally(page)).toBe(false);
  });
}
