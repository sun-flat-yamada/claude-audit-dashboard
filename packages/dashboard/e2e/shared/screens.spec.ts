import { openRoute } from '../support/app';
import { discoverIds, SCREENS } from '../support/routes';
import { expect, test } from '../support/test';

// Every route renders in every data profile: data, or an explanatory notice, never a crash.
for (const screen of SCREENS) {
  test(`renders ${screen.name}`, async ({ page, request }) => {
    const ids = await discoverIds(request);
    await openRoute(page, screen.path(ids));
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    // A failed load is an alert; "not collected" / "not published" are plain status notices.
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText(/undefined|NaN|\[object Object\]/);
  });
}
