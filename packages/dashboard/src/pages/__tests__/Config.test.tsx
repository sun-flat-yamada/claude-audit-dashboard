import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Config } from '../Config';

const raw = (files: Record<string, string>): string | undefined => Object.values(files)[0];
// Synthetic sample only (never live data).
const SAMPLE_CONFIG = raw(
  import.meta.glob<string>('../../../../../data/sample/detail/config.json', {
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
const rule = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Rule ${id}`,
  category: 'access-control',
  severity: 'medium',
  enabled: true,
  origin: 'builtin',
  requires: ['members'],
  paramsValid: true,
  parameters: [],
  ...over,
});
const configFile = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  generatedAt: NOW,
  rules: [
    rule('AC-001', {
      parameters: [{ key: 'inactiveDays', value: 45, defaultValue: 90, overridden: true }],
    }),
    rule('AK-003', {
      parameters: [{ key: 'maxAgeDays', value: 180, defaultValue: 180, overridden: false }],
    }),
    rule('DG-001', { enabled: false, category: 'data-governance' }),
    rule('CF-010', { origin: 'custom', requires: ['settings'] }),
    rule('UA-002', { paramsValid: false }),
  ],
  customRules: [
    {
      id: 'CF-010',
      kind: 'setting-baseline',
      name: 'Web Search Off',
      severity: 'low',
      enabled: true,
      replacesBuiltin: false,
      summary: 'web_search_enabled = false',
    },
  ],
  unknownRuleIds: { disabled: ['XX-123'], parameters: [] },
  sources: {
    datasets: [
      { name: 'members', enabled: true },
      { name: 'usage', enabled: false },
    ],
    membersProvider: 'admin',
    memberActivityLookbackDays: 90,
    groupMemberRequestLimit: 200,
    activities: {
      initialLookbackHours: 168,
      overlapMinutes: 10,
      lagMinutes: 2,
      pageSize: 5000,
      includedTypeCount: 0,
      excludedTypeCount: 8,
    },
  },
  notifications: {
    statuses: ['fail', 'warning'],
    minSeverity: 'medium',
    cooldownMinutes: 240,
    channels: [
      { kind: 'console', enabled: true },
      { kind: 'slack', enabled: true },
      { kind: 'discord', enabled: false },
      { kind: 'email', enabled: false },
    ],
  },
  retention: { snapshotDays: 365 },
  dashboard: { maskPii: true },
  ...over,
});
const manifest = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  generatedAt: NOW,
  collectedAt: NOW,
  source: 'demo',
  maskPii: true,
  files: [
    {
      kind: 'config',
      path: 'detail/config.json',
      schemaVersion: 1,
      status: 'ok',
      reason: null,
      count: 5,
      month: null,
    },
  ],
  ...over,
});

type Reply = unknown | 404 | 500;
function serve(routes: { config: Reply; manifest: Reply }): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const reply = String(url).endsWith('/config.json') ? routes.config : routes.manifest;
    if (typeof reply === 'number') return new Response('{}', { status: reply });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
}
const open = (routes: { config: Reply; manifest: Reply }) =>
  render(<Config baseUrl="/" fetchImpl={serve(routes)} />);
const search = () => screen.getByRole('searchbox', { name: 'Search configuration' });

describe('Config page', () => {
  it('groups the effective configuration into read-only sections', async () => {
    open({ config: configFile(), manifest: manifest() });
    expect(await screen.findByRole('table', { name: 'Compliance rules' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Configuration' })).toBeInTheDocument();
    for (const name of ['Rule parameters', 'Custom rules', 'Notification channels', 'Data sources'])
      expect(screen.getByRole('table', { name })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Notification policy' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/5 rules: 4 enabled, 1 disabled, 1 custom/)).toBeInTheDocument();
    expect(screen.getByText(/match no rule: XX-123/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows enabled / disabled with an icon, a label and the custom origin', async () => {
    open({ config: configFile(), manifest: manifest() });
    const rules = await screen.findByRole('table', { name: 'Compliance rules' });
    const off = within(rules).getByRole('row', { name: /Rule DG-001/ });
    expect(within(off).getByText('Disabled')).toBeInTheDocument();
    expect(off).toHaveAttribute('data-enabled', 'false');
    expect(
      within(within(rules).getByRole('row', { name: /Rule AC-001/ })).getByText('Enabled'),
    ).toBeInTheDocument();
    expect(
      within(within(rules).getByRole('row', { name: /Rule CF-010/ })).getByText('Custom rule'),
    ).toBeInTheDocument();
  });

  it('shows effective values with defaults and flags overridden or rejected parameters', async () => {
    open({ config: configFile(), manifest: manifest() });
    const table = await screen.findByRole('table', { name: 'Rule parameters' });
    const over = within(table).getByRole('row', { name: /inactiveDays/ });
    expect(within(over).getByText('45')).toBeInTheDocument();
    expect(within(over).getByText('90')).toBeInTheDocument();
    expect(within(over).getByText('Overridden')).toBeInTheDocument();
    expect(
      within(within(table).getByRole('row', { name: /maxAgeDays/ })).getByText('Default'),
    ).toBeInTheDocument();
    expect(
      within(within(table).getByRole('row', { name: /Rule UA-002/ })).getByText('Invalid'),
    ).toBeInTheDocument();
  });

  it('lists notification channels by kind and data sources with their state', async () => {
    open({ config: configFile(), manifest: manifest() });
    const channels = await screen.findByRole('table', { name: 'Notification channels' });
    expect(
      within(within(channels).getByRole('row', { name: /Slack/ })).getByText('Enabled'),
    ).toBeInTheDocument();
    expect(
      within(within(channels).getByRole('row', { name: /Discord/ })).getByText('Disabled'),
    ).toBeInTheDocument();
    const sources = screen.getByRole('table', { name: 'Data sources' });
    expect(
      within(within(sources).getByRole('row', { name: /usage/ })).getByText('Disabled'),
    ).toBeInTheDocument();
    expect(screen.getByText('Minimum severity')).toBeInTheDocument();
    expect(screen.getByText('240 minutes')).toBeInTheDocument();
  });

  it('lists the optional Console and Claude Code datasets next to the built-in ones', async () => {
    const datasets = [
      { name: 'members', enabled: true },
      { name: 'consoleWorkspaces', enabled: true },
      { name: 'consoleCost', enabled: true },
      { name: 'claudeCodeActivity', enabled: true },
    ];
    const config = configFile();
    open({
      config: { ...config, sources: { ...config.sources, datasets } },
      manifest: manifest(),
    });
    const sources = await screen.findByRole('table', { name: 'Data sources' });
    for (const name of ['consoleWorkspaces', 'consoleCost', 'claudeCodeActivity'])
      expect(
        within(within(sources).getByRole('row', { name: new RegExp(name) })).getByText('Enabled'),
      ).toBeInTheDocument();
    expect(within(sources).getAllByRole('row')).toHaveLength(datasets.length + 1);
  });

  it('filters rules by state', async () => {
    const user = userEvent.setup();
    open({ config: configFile(), manifest: manifest() });
    await screen.findByRole('table', { name: 'Compliance rules' });
    await user.click(screen.getByRole('button', { name: /^Disabled/ }));
    const rules = screen.getByRole('table', { name: 'Compliance rules' });
    expect(within(rules).getAllByRole('row')).toHaveLength(2);
    expect(within(rules).getByText('Rule DG-001')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Custom/ }));
    expect(
      within(screen.getByRole('table', { name: 'Compliance rules' })).getByText('Rule CF-010'),
    ).toBeInTheDocument();
  });

  it('searches across all sections and reports no match', async () => {
    const user = userEvent.setup();
    open({ config: configFile(), manifest: manifest() });
    await screen.findByRole('table', { name: 'Compliance rules' });
    await user.type(search(), 'slack');
    expect(screen.getByRole('table', { name: 'Notification channels' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Compliance rules' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Data sources' })).not.toBeInTheDocument();
    await user.clear(search());
    await user.type(search(), 'inactiveDays');
    expect(screen.getByRole('table', { name: 'Rule parameters' })).toBeInTheDocument();
    await user.clear(search());
    await user.type(search(), 'zzzz-nothing');
    expect(screen.getByText('No configuration matches the current search.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an empty custom-rules message when none are defined', async () => {
    open({ config: configFile({ customRules: [] }), manifest: manifest() });
    expect(await screen.findByText('No custom rules are defined.')).toBeInTheDocument();
  });

  it('renders the empty state for a file without entries', async () => {
    open({
      config: configFile({
        rules: [],
        customRules: [],
        sources: { ...configFile().sources, datasets: [] },
      }),
      manifest: manifest(),
    });
    expect(
      await screen.findByText('This file holds no configuration entries.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('explains a configuration that was not collected with the manifest reason', async () => {
    const unavailable = manifest({
      files: [
        {
          kind: 'config',
          path: 'detail/config.json',
          schemaVersion: 1,
          status: 'unavailable',
          reason: 'configuration could not be read',
          count: null,
          month: null,
        },
      ],
    });
    open({ config: 404, manifest: unavailable });
    expect(
      await screen.findByText(
        'Configuration data was not collected (configuration could not be read).',
      ),
    ).toBeInTheDocument();
  });

  it('renders "not published" when the detail files are missing, never an error screen', async () => {
    open({ config: 404, manifest: 404 });
    expect(await screen.findByText(/Configuration data is not published/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a failing request and an invalid file as an alert', async () => {
    const failed = open({ config: 500, manifest: 404 });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load configuration: HTTP 500',
    );
    failed.unmount();
    open({ config: { schemaVersion: 2 }, manifest: 404 });
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load configuration');
  });

  it('shows a loading status first', () => {
    open({ config: configFile(), manifest: manifest() });
    expect(screen.getByRole('status')).toHaveTextContent('Loading configuration');
  });

  it.skipIf(SAMPLE_CONFIG === undefined)('renders the synthetic sample', async () => {
    open({
      config: JSON.parse(SAMPLE_CONFIG ?? '{}'),
      manifest: JSON.parse(SAMPLE_MANIFEST ?? '{}'),
    });
    const rules = await screen.findByRole('table', { name: 'Compliance rules' });
    expect(within(rules).getByText('Disabled')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Custom rules' })).getByText('Web Search Disabled'),
    ).toBeInTheDocument();
    expect(screen.getByText('Overridden')).toBeInTheDocument();
    const channels = screen.getByRole('table', { name: 'Notification channels' });
    expect(within(channels).getAllByText('Enabled').length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).not.toMatch(/https?:|@|sk-ant/);
  });
});
