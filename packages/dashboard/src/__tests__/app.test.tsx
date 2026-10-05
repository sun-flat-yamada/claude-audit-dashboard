import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

// Only the synthetic sources are read here, never data/dashboard.json (live data).
const raw = <T extends Record<string, string>>(files: T): string | undefined =>
  Object.values(files)[0];
const SAMPLE = raw(
  import.meta.glob<string>('../../../../data/sample/dashboard.json', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
);
// Written by `pnpm fixture` (gitignored; `pnpm test` regenerates it); absent when this package's
// tests run on their own before it was generated.
const FIXTURE = raw(
  import.meta.glob<string>('../../../../data/fixture/dashboard.json', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
);
const DETAIL = import.meta.glob<string>(
  '../../../../data/sample/detail/{index,members,api-keys,org-groups,config,archive,activity-*}.json',
  {
    eager: true,
    query: '?raw',
    import: 'default',
  },
);
const MONTHLY = import.meta.glob<string>('../../../../data/sample/detail/monthly/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const SOURCES: Array<[string, string | undefined]> = [
  ['sample', SAMPLE],
  ['fixtures', FIXTURE],
];

function stubFetch(body: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status: 200 })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe.each(SOURCES)('App with the %s data source', (name, body) => {
  // The fixtures file only exists after `pnpm fixture`; the sample source always exists.
  describe.skipIf(body === undefined)(name, () => {
    beforeEach(() => stubFetch(body ?? ''));

    it('renders the Overview at the root', async () => {
      render(<App />);
      expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByRole('main')).toBeInTheDocument();
    });

    it('opens the Compliance page by deep link with the export buttons', async () => {
      window.location.hash = '#/compliance';
      render(<App />);
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Compliance results' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Compliance' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByRole('button', { name: 'Export all CSV' })).toBeEnabled();
      window.location.hash = '#/';
    });
  });
});

describe('hash routing', () => {
  beforeEach(() => stubFetch(SAMPLE ?? ''));

  it('opens the Members page by deep link from the sample detail files', async () => {
    const byName = (name: string) =>
      Object.entries(DETAIL).find(([path]) => path.endsWith(name))?.[1] ?? '{}';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const path = String(url);
        if (path.endsWith('/members.json')) return new Response(byName('/members.json'));
        if (path.endsWith('/detail/index.json')) return new Response(byName('/index.json'));
        return new Response(SAMPLE ?? '');
      }),
    );
    window.location.hash = '#/members';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('table', { name: 'Members' })).toBeInTheDocument();
  });

  it('opens the organization and group drill-downs by deep link', async () => {
    const byName = (suffix: string) =>
      Object.entries(DETAIL).find(([name]) => name.endsWith(suffix))?.[1] ?? '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const path = String(url);
        if (path.endsWith('/org-groups.json')) return new Response(byName('/org-groups.json'));
        if (path.endsWith('/members.json')) return new Response(byName('/members.json'));
        if (path.endsWith('/detail/index.json')) return new Response(byName('/index.json'));
        return new Response(SAMPLE ?? '');
      }),
    );
    window.location.hash = '#/orgs/5f0c7a1e-3333-4a1a-9a11-000000000003';
    const { unmount } = render(<App />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Example Corp Sales' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Organizations' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      await screen.findByRole('table', { name: 'Configuration deviations' }),
    ).toBeInTheDocument();
    unmount();
    window.location.hash = '#/groups/rbac_group_demo_sales';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sales' })).toBeInTheDocument();
  });

  it('opens the monthly cost report by deep link, with a month deep link keeping the nav item current', async () => {
    const monthly = (file: string) =>
      Object.entries(MONTHLY).find(([name]) => name.endsWith(`/${file}`))?.[1] ?? '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const file = /\/detail\/monthly\/([^/]+\.json)$/.exec(String(url))?.[1];
        return new Response(file ? monthly(file) : (SAMPLE ?? ''));
      }),
    );
    window.location.hash = '#/reports/monthly';
    const { unmount } = render(<App />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Monthly cost report' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Monthly report' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      await screen.findByRole('table', { name: 'Chargeback by RBAC group' }),
    ).toBeInTheDocument();
    unmount();
    window.location.hash = '#/reports/monthly/monthly-2026-06';
    render(<App />);
    expect(await screen.findByRole('combobox', { name: 'Month' })).toHaveValue('monthly-2026-06');
    expect(screen.getByRole('link', { name: 'Monthly report' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('opens the activity timeline by deep link', async () => {
    const byName = (suffix: string) =>
      Object.entries(DETAIL).find(([name]) => name.endsWith(suffix))?.[1] ?? '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const path = String(url);
        const month = /activity-(\d{4}-\d{2})\.json$/.exec(path)?.[1];
        if (month) return new Response(byName(`/activity-${month}.json`));
        if (path.endsWith('/detail/index.json')) return new Response(byName('/index.json'));
        return new Response(SAMPLE ?? '');
      }),
    );
    window.location.hash = '#/activity';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('table', { name: 'Activity timeline' })).toBeInTheDocument();
  });

  it('opens the API key inventory by deep link', async () => {
    const byName = (suffix: string) =>
      Object.entries(DETAIL).find(([name]) => name.endsWith(suffix))?.[1] ?? '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const path = String(url);
        if (path.endsWith('/api-keys.json')) return new Response(byName('/api-keys.json'));
        if (path.endsWith('/detail/index.json')) return new Response(byName('/index.json'));
        return new Response(SAMPLE ?? '');
      }),
    );
    window.location.hash = '#/keys';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'API keys' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'API keys' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('table', { name: 'API keys' })).toBeInTheDocument();
  });

  it('opens the effective configuration by deep link', async () => {
    const byName = (suffix: string) =>
      Object.entries(DETAIL).find(([name]) => name.endsWith(suffix))?.[1] ?? '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const path = String(url);
        if (path.endsWith('/config.json')) return new Response(byName('/config.json'));
        if (path.endsWith('/detail/index.json')) return new Response(byName('/index.json'));
        return new Response(SAMPLE ?? '');
      }),
    );
    window.location.hash = '#/config';
    render(<App />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Configuration' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configuration' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByRole('table', { name: 'Compliance rules' })).toBeInTheDocument();
  });

  it('opens the archive inventory by deep link', async () => {
    const byName = (suffix: string) =>
      Object.entries(DETAIL).find(([name]) => name.endsWith(suffix))?.[1] ?? '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const path = String(url);
        if (path.endsWith('/archive.json')) return new Response(byName('/archive.json'));
        if (path.endsWith('/detail/index.json')) return new Response(byName('/index.json'));
        return new Response(SAMPLE ?? '');
      }),
    );
    window.location.hash = '#/archive';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Archive' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('table', { name: 'Archive by year' })).toBeInTheDocument();
  });

  it('shows the not-found page for an unknown deep link and recovers with back/forward', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/nope';
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');

    await user.click(screen.getByRole('link', { name: 'Back to the overview' }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
    expect(window.location.hash).toBe('#/');

    window.history.back();
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    window.history.forward();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull(),
    );
  });

  it('skip link moves focus to main without changing the route', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/';
    render(<App />);
    await screen.findByRole('navigation', { name: 'Primary' });
    await user.click(screen.getByRole('link', { name: 'Skip to main content' }));
    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.location.hash).toBe('#/');
  });

  it('shows an alert when the data cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load dashboard data');
  });
});

describe('App theme toggle', () => {
  it.skipIf(SAMPLE === undefined)('shows the theme switch in the primary navigation', async () => {
    stubFetch(SAMPLE ?? '');
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('group', { name: 'Theme' })).toBeInTheDocument();
  });
});
