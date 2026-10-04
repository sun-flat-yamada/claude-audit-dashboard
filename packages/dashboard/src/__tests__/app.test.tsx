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
const DETAIL = import.meta.glob<string>('../../../../data/sample/detail/{index,members}.json', {
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
