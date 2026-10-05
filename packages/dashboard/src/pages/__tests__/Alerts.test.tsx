import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Alerts } from '../Alerts';

const raw = (files: Record<string, string>): string | undefined => Object.values(files)[0];
// Synthetic sample only (never live data).
const SAMPLE_ALERTS = raw(
  import.meta.glob<string>('../../../../../data/sample/detail/alerts.json', {
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
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'al_aaaaaaaaaaaa',
  sentAt: '2026-09-28T12:00:00.000Z',
  kind: 'compliance',
  severity: 'high',
  title: 'Claude Enterprise audit: 2 finding(s), score 79%',
  channels: ['console', 'slack'],
  findings: [
    { ruleId: 'AC-001', status: 'fail' },
    { ruleId: 'AK-001', status: 'warning' },
  ],
  acknowledged: false,
  acknowledgedAt: null,
  acknowledgedBy: null,
  ...over,
});
const ackedEntry = entry({
  id: 'al_bbbbbbbbbbbb',
  sentAt: '2026-09-24T12:00:00.000Z',
  kind: 'collection',
  severity: 'medium',
  title: 'Claude audit collection failure',
  channels: ['discord'],
  findings: [],
  acknowledged: true,
  acknowledgedAt: '2026-09-24T14:00:00.000Z',
  acknowledgedBy: 'sec-oncall',
});
const alertsFile = (alerts: unknown[] = [entry(), ackedEntry]) => ({
  schemaVersion: 1,
  generatedAt: NOW,
  totals: {
    alerts: alerts.length,
    acknowledged: alerts.filter((a) => (a as { acknowledged: boolean }).acknowledged).length,
    unacknowledged: alerts.filter((a) => !(a as { acknowledged: boolean }).acknowledged).length,
  },
  alerts,
});
const manifest = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  generatedAt: NOW,
  collectedAt: NOW,
  source: 'demo',
  maskPii: true,
  files: [
    {
      kind: 'alerts',
      path: 'detail/alerts.json',
      schemaVersion: 1,
      status: 'ok',
      reason: null,
      count: 2,
      month: null,
    },
  ],
  ...over,
});

type Reply = unknown | 404 | 500;
function serve(routes: { alerts: Reply; manifest: Reply }): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const reply = String(url).endsWith('/alerts.json') ? routes.alerts : routes.manifest;
    if (typeof reply === 'number') return new Response('{}', { status: reply });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
}
const open = (routes: { alerts: Reply; manifest: Reply }) =>
  render(<Alerts baseUrl="/" fetchImpl={serve(routes)} />);
const search = () => screen.getByRole('searchbox', { name: 'Search alerts' });
const chip = (name: RegExp) =>
  within(screen.getByRole('group', { name: 'Filter by acknowledgement' })).getByRole('button', {
    name,
  });

describe('Alerts page', () => {
  it('lists alerts with severity, rules, channels and acknowledgement status', async () => {
    open({ alerts: alertsFile(), manifest: manifest() });
    const table = await screen.findByRole('table', { name: 'Alert history' });
    expect(screen.getByRole('heading', { level: 1, name: 'Alerts' })).toBeInTheDocument();
    const open1 = within(table).getByRole('row', { name: /al_aaaaaaaaaaaa/ });
    expect(within(open1).getByText('high')).toBeInTheDocument();
    expect(within(open1).getByText('AC-001, AK-001')).toBeInTheDocument();
    expect(within(open1).getByText('Console, Slack')).toBeInTheDocument();
    expect(within(open1).getByText('Unacknowledged')).toBeInTheDocument();
    const done = within(table).getByRole('row', { name: /al_bbbbbbbbbbbb/ });
    expect(within(done).getByText('Acknowledged')).toBeInTheDocument();
    expect(within(done).getByText(/by sec-oncall/)).toBeInTheDocument();
    expect(within(done).getByText('Discord')).toBeInTheDocument();
  });

  it('shows totals and how to acknowledge (command and workflow), read-only', async () => {
    open({ alerts: alertsFile(), manifest: manifest() });
    await screen.findByRole('table', { name: 'Alert history' });
    expect(screen.getByText('How to acknowledge an alert')).toBeInTheDocument();
    expect(screen.getByText(/pnpm alerts ack <alert-id>/)).toBeInTheDocument();
    expect(screen.getByText('Acknowledge Alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Alert totals')).toHaveTextContent('Alerts sent2');
    // The SPA cannot write: the only buttons are the status filters, none acts on an alert.
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['All 2', 'Acknowledged 1', 'Unacknowledged 1']);
  });

  it('shows "Not recorded" for alerts sent before channels were recorded', async () => {
    open({
      alerts: alertsFile([entry({ channels: [], severity: 'unknown' })]),
      manifest: manifest(),
    });
    expect(await screen.findByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });

  it('filters by acknowledgement status with counts', async () => {
    const user = userEvent.setup();
    open({ alerts: alertsFile(), manifest: manifest() });
    const table = await screen.findByRole('table', { name: 'Alert history' });
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip(/^Acknowledged/));
    expect(within(table).queryByText(/al_aaaaaaaaaaaa/)).not.toBeInTheDocument();
    expect(within(table).getByText(/al_bbbbbbbbbbbb/)).toBeInTheDocument();
    expect(screen.getByText('1 of 2 alerts shown')).toBeInTheDocument();
    await user.click(chip(/^Unacknowledged/));
    expect(within(table).getByText(/al_aaaaaaaaaaaa/)).toBeInTheDocument();
    expect(within(table).queryByText(/al_bbbbbbbbbbbb/)).not.toBeInTheDocument();
  });

  it('searches and reports no match', async () => {
    const user = userEvent.setup();
    open({ alerts: alertsFile(), manifest: manifest() });
    await screen.findByRole('table', { name: 'Alert history' });
    await user.type(search(), 'discord');
    expect(screen.getByText('1 of 2 alerts shown')).toBeInTheDocument();
    await user.clear(search());
    await user.type(search(), 'zzzz');
    expect(screen.getByText('No alerts match the current search and filter.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders the empty state when no alert was sent', async () => {
    open({ alerts: alertsFile([]), manifest: manifest() });
    expect(await screen.findByText(/No alerts sent yet/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByText('How to acknowledge an alert')).toBeInTheDocument();
  });

  it('explains an unreadable history with the manifest reason', async () => {
    const unavailable = manifest({
      files: [
        {
          kind: 'alerts',
          path: 'detail/alerts.json',
          schemaVersion: 1,
          status: 'unavailable',
          reason: 'the alert history could not be read',
          count: null,
          month: null,
        },
      ],
    });
    open({ alerts: 404, manifest: unavailable });
    expect(
      await screen.findByText(
        'Alert history data was not collected (the alert history could not be read).',
      ),
    ).toBeInTheDocument();
  });

  it('renders "not published" when the detail files are missing, never an error screen', async () => {
    open({ alerts: 404, manifest: 404 });
    expect(await screen.findByText(/Alert history data is not published/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a failing request and an invalid file as an alert', async () => {
    const failed = open({ alerts: 500, manifest: 404 });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load alert history: HTTP 500',
    );
    failed.unmount();
    open({ alerts: { schemaVersion: 2 }, manifest: 404 });
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load alert history');
  });

  it('shows a loading status first', () => {
    open({ alerts: alertsFile(), manifest: manifest() });
    expect(screen.getByRole('status')).toHaveTextContent('Loading alert history');
  });

  it.skipIf(SAMPLE_ALERTS === undefined)('renders the synthetic sample', async () => {
    open({
      alerts: JSON.parse(SAMPLE_ALERTS ?? '{}'),
      manifest: JSON.parse(SAMPLE_MANIFEST ?? '{}'),
    });
    const table = await screen.findByRole('table', { name: 'Alert history' });
    expect(within(table).getAllByRole('row').length).toBeGreaterThanOrEqual(6);
    expect(within(table).getAllByText('Acknowledged').length).toBeGreaterThanOrEqual(1);
    expect(within(table).getAllByText('Unacknowledged').length).toBeGreaterThanOrEqual(1);
    for (const channel of ['Slack', 'Discord', 'E-mail', 'Console'])
      expect(within(table).getAllByText(new RegExp(channel)).length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toMatch(/https?:\/\/|@/);
  });
});
