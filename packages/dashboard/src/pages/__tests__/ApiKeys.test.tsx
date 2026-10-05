import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiKeys } from '../ApiKeys';

const raw = (files: Record<string, string>): string | undefined => Object.values(files)[0];
// Synthetic sample only (never live data).
const SAMPLE_KEYS = raw(
  import.meta.glob<string>('../../../../../data/sample/detail/api-keys.json', {
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
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();
const apiKey = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Key ${id}`,
  scopes: ['read:compliance_activities'],
  active: true,
  createdAt: daysAgo(10),
  expiresAt: null,
  createdBy: null,
  lastSeenAt: daysAgo(1),
  ...over,
});
const keysFile = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  generatedAt: NOW,
  unusedDays: 30,
  maxAgeDays: 180,
  usageObservedFrom: daysAgo(120),
  keys: [
    apiKey('k_fresh', { name: 'Fresh key' }),
    apiKey('k_old', { name: 'Old key', createdAt: daysAgo(400) }),
    apiKey('k_soon', { name: 'Soon key', createdAt: daysAgo(150) }),
    apiKey('k_idle', {
      name: 'Idle key',
      lastSeenAt: null,
      scopes: ['delete:compliance_user_data'],
    }),
    apiKey('k_off', { name: 'Retired key', active: false, createdAt: daysAgo(900) }),
  ],
  ...over,
});
const manifest = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  generatedAt: NOW,
  collectedAt: NOW,
  source: 'demo',
  maskPii: true,
  files: [
    {
      kind: 'api-keys',
      path: 'detail/api-keys.json',
      schemaVersion: 2,
      status: 'ok',
      reason: null,
      count: 5,
      month: null,
    },
  ],
  ...over,
});

type Reply = unknown | 404 | 500;
function serve(routes: { keys: Reply; manifest: Reply }): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const reply = String(url).endsWith('/api-keys.json') ? routes.keys : routes.manifest;
    if (typeof reply === 'number') return new Response('{}', { status: reply });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
}
const open = (routes: { keys: Reply; manifest: Reply }) =>
  render(<ApiKeys baseUrl="/" fetchImpl={serve(routes)} />);

describe('ApiKeys page', () => {
  it('lists keys with age, last use and an icon + label recommendation', async () => {
    open({ keys: keysFile(), manifest: manifest() });
    expect(await screen.findByRole('table', { name: 'API keys' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'API keys' })).toBeInTheDocument();
    const old = screen.getByRole('row', { name: /Old key/ });
    expect(within(old).getByText('400 days')).toBeInTheDocument();
    expect(within(old).getByText('Rotate')).toBeInTheDocument();
    expect(within(old).getByText(/over the 180-day limit \(AK-003\)/)).toBeInTheDocument();
    const soon = screen.getByRole('row', { name: /Soon key/ });
    expect(within(soon).getByText('Rotate soon')).toBeInTheDocument();
    const idle = screen.getByRole('row', { name: /Idle key/ });
    expect(within(idle).getByText('Unused')).toBeInTheDocument();
    expect(within(idle).getByText('Not seen')).toBeInTheDocument();
    expect(within(idle).getByText(/Holds write or delete scopes/)).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Retired key/ })).getByText('Deactivated'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Fresh key/ })).getByText('OK'),
    ).toBeInTheDocument();
  });

  it('takes thresholds from the data and counts ages at the file time', async () => {
    open({ keys: keysFile({ maxAgeDays: 90, unusedDays: 14 }), manifest: manifest() });
    expect(await screen.findByText(/old after 90 days \(AK-003\)/)).toBeInTheDocument();
    expect(screen.getByText(/unused after 14 days/)).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Soon key/ })).getByText('Rotate'),
    ).toBeInTheDocument();
  });

  it('lists the most urgent keys first', async () => {
    open({ keys: keysFile(), manifest: manifest() });
    await screen.findByRole('table', { name: 'API keys' });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveAttribute('data-recommendation', 'rotate');
    expect(rows[rows.length - 1]).toHaveAttribute('data-recommendation', 'inactive');
  });

  it('filters by recommendation and search text, and sorts', async () => {
    const user = userEvent.setup();
    open({ keys: keysFile(), manifest: manifest() });
    await screen.findByRole('table', { name: 'API keys' });
    await user.click(screen.getByRole('button', { name: /^Rotate soon/ }));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /^All/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Search keys' }), 'idle');
    expect(screen.getByText('Idle key')).toBeInTheDocument();
    expect(screen.queryByText('Old key')).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search keys' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search keys' }), 'nobody');
    expect(screen.getByText('No keys match the current filters.')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search keys' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name');
    const names = () => screen.getAllByRole('rowheader').map((h) => h.textContent ?? '');
    expect(names()[0]).toContain('Fresh key');
    await user.click(screen.getByRole('button', { name: 'Descending' }));
    expect(names()[0]).toContain('Soon key');
  });

  it('shows masked IDs with the note when maskPii is on, raw IDs when it is off', async () => {
    const masked = open({
      keys: keysFile({ keys: [apiKey('k_5fa8cc39f7b0', { name: 'Masked' })] }),
      manifest: manifest(),
    });
    expect(await screen.findByText(/Key IDs are masked \(maskPii is on\)/)).toBeInTheDocument();
    expect(screen.getByText('k_5fa8cc39f7b0')).toBeInTheDocument();
    masked.unmount();
    open({
      keys: keysFile({ keys: [apiKey('key_01RawExample', { name: 'Raw' })] }),
      manifest: manifest({ maskPii: false }),
    });
    expect(await screen.findByText(/unmasked \(maskPii is off\)/)).toBeInTheDocument();
    expect(screen.getByText('key_01RawExample')).toBeInTheDocument();
  });

  it('never renders key material and states so', async () => {
    open({ keys: keysFile(), manifest: manifest() });
    expect(await screen.findByText(/Key secrets are never collected or shown/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sk-ant/);
  });

  it('renders the empty state when there are no keys', async () => {
    open({ keys: keysFile({ keys: [] }), manifest: manifest() });
    expect(await screen.findByText('No API keys in this organization.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('explains an unavailable dataset with the manifest reason', async () => {
    const unavailable = manifest({
      files: [
        {
          kind: 'api-keys',
          path: 'detail/api-keys.json',
          schemaVersion: 2,
          status: 'unavailable',
          reason: 'credentials endpoint not permitted',
          count: null,
          month: null,
        },
      ],
    });
    open({ keys: 404, manifest: unavailable });
    expect(
      await screen.findByText(
        'API key data was not collected (credentials endpoint not permitted).',
      ),
    ).toBeInTheDocument();
  });

  it('renders "not published" when the detail files are missing, never an error screen', async () => {
    open({ keys: 404, manifest: 404 });
    expect(await screen.findByText(/API key data is not published/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a failing request as an alert', async () => {
    open({ keys: 500, manifest: 404 });
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load API keys: HTTP 500');
  });

  it('shows a loading status first', () => {
    open({ keys: keysFile(), manifest: manifest() });
    expect(screen.getByRole('status')).toHaveTextContent('Loading API keys');
  });

  it.skipIf(SAMPLE_KEYS === undefined)('renders the synthetic sample', async () => {
    open({
      keys: JSON.parse(SAMPLE_KEYS ?? '{}'),
      manifest: JSON.parse(SAMPLE_MANIFEST ?? '{}'),
    });
    const table = await screen.findByRole('table', { name: 'API keys' });
    expect(within(table).getByText('Rotate')).toBeInTheDocument();
    expect(within(table).getByText('Unused')).toBeInTheDocument();
    expect(within(table).getByText('Deactivated')).toBeInTheDocument();
  });
});
