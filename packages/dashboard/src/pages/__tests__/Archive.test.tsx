import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Archive } from '../Archive';

const raw = (files: Record<string, string>): string | undefined => Object.values(files)[0];
// Synthetic sample only (never live data).
const SAMPLE_ARCHIVE = raw(
  import.meta.glob<string>('../../../../../data/sample/detail/archive.json', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
);
const SAMPLE_MANIFEST = raw(
  import.meta.glob<string>('../../../../../data/sample/detail/index.json', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
);

const NOW = '2026-09-29T12:00:00.000Z';
const TB = 2 ** 40;
const archiveFile = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  generatedAt: NOW,
  snapshotDays: 365,
  years: [
    {
      year: '2025',
      snapshots: 36,
      bytes: 3 * TB + 2 ** 39,
      oldest: '2025-01-01T06-00-00Z',
      newest: '2025-09-22T06-00-00Z',
    },
    {
      year: '2024',
      snapshots: 4,
      bytes: 1536,
      oldest: '2024-03-01T06-00-00Z',
      newest: '2024-12-22T06-00-00Z',
    },
  ],
  totals: {
    snapshots: 40,
    bytes: 3 * TB + 2 ** 39 + 1536,
    years: 2,
    oldest: '2024-03-01T06-00-00Z',
    newest: '2025-09-22T06-00-00Z',
  },
  ignoredEntries: 0,
  ...over,
});
const emptyFile = () =>
  archiveFile({
    years: [],
    totals: { snapshots: 0, bytes: 0, years: 0, oldest: null, newest: null },
  });
const manifest = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  generatedAt: NOW,
  collectedAt: NOW,
  source: 'demo',
  maskPii: true,
  files: [
    {
      kind: 'archive',
      path: 'detail/archive.json',
      schemaVersion: 1,
      status: 'ok',
      reason: null,
      count: 40,
      month: null,
    },
  ],
  ...over,
});

type Reply = unknown | 404 | 500;
function serve(routes: { archive: Reply; manifest: Reply }): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const reply = String(url).endsWith('/archive.json') ? routes.archive : routes.manifest;
    if (typeof reply === 'number') return new Response('{}', { status: reply });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
}
const open = (routes: { archive: Reply; manifest: Reply }) =>
  render(<Archive baseUrl="/" fetchImpl={serve(routes)} />);
const search = () => screen.getByRole('searchbox', { name: 'Search years' });

describe('Archive page', () => {
  it('shows totals, retention and the per-year table', async () => {
    open({ archive: archiveFile(), manifest: manifest() });
    const table = await screen.findByRole('table', { name: 'Archive by year' });
    expect(screen.getByRole('heading', { level: 1, name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByText('Archived snapshots')).toBeInTheDocument();
    expect(screen.getByText('Retention before archiving')).toBeInTheDocument();
    expect(screen.getByText('365 days')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByText('2025-09-22 06:00 UTC', { selector: 'dd' })).toBeInTheDocument();
    const row = within(table).getByRole('row', { name: /^2025/ });
    expect(within(row).getByText('36')).toBeInTheDocument();
    expect(within(row).getByText('3.5 TB')).toBeInTheDocument();
    expect(within(row).getByText('2025-01-01 06:00 UTC')).toBeInTheDocument();
    expect(
      within(within(table).getByRole('row', { name: /^2024/ })).getByText('1.5 KB'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('formats a total of several terabytes', async () => {
    open({ archive: archiveFile(), manifest: manifest() });
    await screen.findByRole('table', { name: 'Archive by year' });
    expect(screen.getAllByText('3.5 TB').length).toBeGreaterThanOrEqual(2);
  });

  it('flags unrecognized files without naming them', async () => {
    open({ archive: archiveFile({ ignoredEntries: 2 }), manifest: manifest() });
    expect(await screen.findByText('Unrecognized files')).toBeInTheDocument();
    expect(screen.getByText(/2 unrecognized entries were ignored/)).toBeInTheDocument();
  });

  it('filters years by search and reports no match', async () => {
    const user = userEvent.setup();
    open({ archive: archiveFile(), manifest: manifest() });
    await screen.findByRole('table', { name: 'Archive by year' });
    await user.type(search(), '2024');
    const table = screen.getByRole('table', { name: 'Archive by year' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('1 of 2 years shown')).toBeInTheDocument();
    await user.clear(search());
    await user.type(search(), 'zzzz');
    expect(screen.getByText('No years match the current search.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders the empty state when nothing has been archived yet', async () => {
    open({ archive: emptyFile(), manifest: manifest() });
    expect(await screen.findByText(/No archived snapshots yet/)).toBeInTheDocument();
    expect(screen.getByText('No archives yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('explains an archive that could not be listed with the manifest reason', async () => {
    const unavailable = manifest({
      files: [
        {
          kind: 'archive',
          path: 'detail/archive.json',
          schemaVersion: 1,
          status: 'unavailable',
          reason: 'the archive could not be listed',
          count: null,
          month: null,
        },
      ],
    });
    open({ archive: 404, manifest: unavailable });
    expect(
      await screen.findByText('Archive data was not collected (the archive could not be listed).'),
    ).toBeInTheDocument();
  });

  it('renders "not published" when the detail files are missing, never an error screen', async () => {
    open({ archive: 404, manifest: 404 });
    expect(await screen.findByText(/Archive data is not published/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a failing request and an invalid file as an alert', async () => {
    const failed = open({ archive: 500, manifest: 404 });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load archive inventory: HTTP 500',
    );
    failed.unmount();
    open({ archive: { schemaVersion: 2 }, manifest: 404 });
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load archive inventory');
  });

  it('shows a loading status first', () => {
    open({ archive: archiveFile(), manifest: manifest() });
    expect(screen.getByRole('status')).toHaveTextContent('Loading archive inventory');
  });

  it.skipIf(SAMPLE_ARCHIVE === undefined)('renders the synthetic multi-year sample', async () => {
    open({
      archive: JSON.parse(SAMPLE_ARCHIVE ?? '{}'),
      manifest: JSON.parse(SAMPLE_MANIFEST ?? '{}'),
    });
    const table = await screen.findByRole('table', { name: 'Archive by year' });
    expect(within(table).getAllByRole('row').length).toBeGreaterThanOrEqual(4);
    expect(within(table).getByRole('row', { name: /^2024/ })).toBeInTheDocument();
    expect(screen.getByText('Unrecognized files')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/https?:|@|README/);
  });
});
