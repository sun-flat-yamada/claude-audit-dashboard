import type { DashboardConsole, DashboardView } from '@claude-audit/core/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { activeKeys, missingText, shareLabel, tokenRows } from '../../lib/console-view';
import { ConsolePage } from '../Console';

const day = (date: string, cost: number) => ({
  date,
  cost,
  uncachedInputTokens: 1000,
  cacheReadInputTokens: 3000,
  cacheCreationInputTokens: 500,
  outputTokens: 500,
});

const share = (key: string, label: string, value: number, percent: number) => ({
  key,
  label,
  value,
  percent,
});

const consoleData = (over: Partial<DashboardConsole> = {}): DashboardConsole => ({
  window: { from: '2026-09-05T00:00:00.000Z', to: '2026-10-05T12:00:00.000Z' },
  currency: 'USD',
  totalCost: 1234.5,
  daily: [day('2026-10-04', 600), day('2026-10-05', 634.5)],
  byModel: [
    share('claude-demo-large', 'claude-demo-large', 1000, 81),
    share('(unattributed)', '(unattributed)', 234.5, 19),
  ],
  byWorkspace: [
    share('wrkspc_prod', 'Example Production', 1100, 89.1),
    share('default', 'Default workspace', 134.5, 10.9),
  ],
  byCostType: [
    share('tokens', 'tokens', 1200, 97.2),
    share('code_execution', 'code_execution', 34.5, 2.8),
  ],
  tokens: { uncachedInput: 2000, cacheRead: 6000, cacheWrite: 1000, output: 1000 },
  cacheReadShare: 66.7,
  webSearchRequests: 420,
  workspaces: { active: 2, archived: 1 },
  apiKeys: [
    { status: 'active', count: 3 },
    { status: 'archived', count: 1 },
  ],
  ...over,
});

const coverage = (status: string, reason: string | null = null) =>
  ['consoleUsage', 'consoleCost', 'consoleWorkspaces', 'consoleApiKeys'].map((dataset) => ({
    dataset,
    status,
    source: null,
    reason,
    count: null,
    asOf: null,
  }));

const open = (over: Partial<DashboardView>) =>
  render(<ConsolePage view={{ coverage: [], ...over } as unknown as DashboardView} />);

describe('Console API page (AN-5)', () => {
  it('shows the headline figures, daily charts, breakdowns and the token table', () => {
    open({ console: consoleData() });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Console API usage and cost' }),
    ).toBeInTheDocument();
    expect(screen.getByText('2026-09-05 – 2026-10-05', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('term').map((t) => t.textContent)).toEqual([
      'Spend',
      'Cache read share',
      'Active workspaces',
      'Active API keys',
      'Web search requests',
    ]);
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual([
      '$1,235',
      '66.7%',
      '2',
      '3',
      '420',
    ]);
    for (const title of [
      'Daily spend',
      'Daily tokens by type',
      'Spend by model',
      'Spend by workspace',
      'Spend by cost type',
      'Tokens by type',
    ])
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    // Bar label and the "View as table" twin.
    expect(screen.getAllByText('Example Production')).toHaveLength(2);
    expect(screen.getAllByText('Default workspace')).toHaveLength(2);
    expect(screen.getAllByText('Code execution')).toHaveLength(2);
    expect(screen.getAllByText('Not model-specific')).toHaveLength(2);
    expect(screen.getByText('$1,100.00 · 89.1%')).toBeInTheDocument();
    const tokens = screen.getByRole('table', { name: 'Tokens by type' });
    expect(within(tokens).getByRole('row', { name: /Cache read/ })).toHaveTextContent('6,000');
    expect(within(tokens).getByRole('row', { name: /Cache read/ })).toHaveTextContent('60.0%');
    expect(screen.getByText(/API keys: 3 active · 1 archived\./)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('labels amounts in the published currency', () => {
    open({ console: consoleData({ currency: 'EUR', totalCost: 99 }) });
    expect(screen.getAllByRole('definition')[0]).toHaveTextContent('€99');
    expect(screen.getAllByText(/€1,100\.00/).length).toBeGreaterThan(0);
  });

  it('shows dashes and empty notes when nothing was reported or counted', () => {
    open({
      console: consoleData({
        totalCost: 0,
        daily: [],
        byModel: [],
        byWorkspace: [],
        byCostType: [],
        tokens: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
        cacheReadShare: null,
        webSearchRequests: 0,
        workspaces: null,
        apiKeys: null,
      }),
    });
    expect(
      screen.getByText('No Console usage or cost was reported in the collected period.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('No spend was reported.')).toHaveLength(3);
    const values = screen.getAllByRole('definition').map((d) => d.textContent);
    expect(values).toEqual(['$0', '—', '—', '—', '0']);
  });

  it('explains how to enable the source when the datasets are absent', () => {
    open({});
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Console API usage and cost are not collected',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('sources.console.enabled')).toBeInTheDocument();
    expect(screen.getByText('ANTHROPIC_CONSOLE_ADMIN_API_KEY')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('term')).not.toBeInTheDocument();
  });

  it('names the reason once when the source is enabled but unavailable or failed', () => {
    const { unmount } = open({ coverage: coverage('unavailable', 'No Console Admin API key') });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Not collected: consoleUsage, consoleCost, consoleWorkspaces, consoleApiKeys (No Console Admin API key).',
    );
    unmount();
    open({ coverage: coverage('error', 'schema drift') });
    expect(screen.getByRole('alert')).toHaveTextContent('schema drift');
  });

  it('formats helpers for partial data', () => {
    expect(activeKeys(consoleData({ apiKeys: [] }))).toBe(0);
    expect(activeKeys(consoleData({ apiKeys: null }))).toBeNull();
    expect(shareLabel('byCostType', share('batch', 'batch', 1, 100))).toBe('batch');
    expect(tokenRows(consoleData()).map((r) => r.share)).toEqual([20, 60, 10, 10]);
    expect(
      missingText([
        {
          dataset: 'consoleCost',
          status: 'error',
          source: null,
          reason: null,
          count: null,
          asOf: null,
        },
      ]),
    ).toBe('Not collected: consoleCost (error).');
  });
});
