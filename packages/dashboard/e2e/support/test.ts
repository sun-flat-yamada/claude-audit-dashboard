import { test as base, expect, type Page } from '@playwright/test';

const LOCAL = /^(http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/|data:|blob:|about:)/;

/**
 * Shared test object. Every context blocks and records requests to anything but the local
 * preview server (the dashboard must work offline); the test fails when one was attempted.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page, context }, use) => {
    const external: string[] = [];
    await context.route(
      (url) => !LOCAL.test(url.href),
      async (route) => {
        external.push(route.request().url());
        await route.abort();
      },
    );
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await use(page);
    expect(external, 'external network requests').toEqual([]);
    expect(pageErrors, 'uncaught page errors').toEqual([]);
  },
});

export { expect };
