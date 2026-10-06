import type { DashboardClaudeCode, DashboardView } from '@claude-audit/core/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { dailyAcceptRate, terminalLabel } from '../../lib/claude-code-view';
import { ClaudeCode } from '../ClaudeCode';

const day = (date: string, accepted: number, rejected: number) => ({
  date,
  actors: 3,
  sessions: 12,
  addedLines: 400,
  removedLines: 90,
  commits: 4,
  pullRequests: 1,
  accepted,
  rejected,
});

const claudeCode = (over: Partial<DashboardClaudeCode> = {}): DashboardClaudeCode => ({
  window: { from: '2026-09-22T00:00:00.000Z', to: '2026-09-29T12:00:00.000Z' },
  currency: 'USD',
  users: 6,
  apiKeys: 2,
  daily: [day('2026-09-28', 90, 10), day('2026-09-29', 0, 0)],
  totals: {
    sessions: 200,
    addedLines: 8284,
    removedLines: 2437,
    commits: 97,
    pullRequests: 27,
    accepted: 90,
    rejected: 10,
    acceptRate: 90,
  },
  byTerminal: [
    { terminal: 'vscode', sessions: 150, percent: 75 },
    { terminal: 'non-interactive', sessions: 50, percent: 25 },
  ],
  byModel: [
    {
      model: 'claude-demo-large',
      inputTokens: 2000,
      outputTokens: 500,
      cacheReadTokens: 6000,
      cacheCreationTokens: 100,
      estimatedCost: 84.76,
    },
    {
      model: 'claude-demo-small',
      inputTokens: 900,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      estimatedCost: null,
    },
  ],
  estimatedCost: 84.76,
  cacheReadShare: 66.9,
  ...over,
});

const coverage = (status: string, reason: string | null = null) => [
  { dataset: 'claudeCodeActivity', status, source: null, reason, count: null, asOf: null },
];

const open = (over: Partial<DashboardView>) =>
  render(<ClaudeCode view={{ coverage: [], ...over } as unknown as DashboardView} />);

describe('Claude Code page (AN-4)', () => {
  it('shows the headline figures, the daily charts, terminals and the model table', () => {
    open({ claudeCode: claudeCode() });
    expect(screen.getByRole('heading', { level: 1, name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByText('2026-09-22 – 2026-09-29', { exact: false })).toBeInTheDocument();
    const stats = screen.getAllByRole('term').map((t) => t.textContent);
    expect(stats).toEqual([
      'Active users',
      'API keys',
      'Sessions',
      'Lines added',
      'Lines removed',
      'Commits',
      'Pull requests',
      'Suggestion accept rate',
      'Estimated cost',
    ]);
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual([
      '6',
      '2',
      '200',
      '8,284',
      '2,437',
      '97',
      '27',
      '90.0%',
      '$84.76',
    ]);
    for (const title of [
      'Daily users and sessions',
      'Lines of code per day',
      'Suggestion accept rate per day',
      'Sessions by terminal',
      'Tokens and estimated cost by model',
    ])
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    expect(screen.getAllByText('VS Code')).toHaveLength(2); // bar label and table twin
    expect(screen.getByText('150 · 75.0%')).toBeInTheDocument();
    const models = screen.getByRole('table', { name: 'Tokens and estimated cost by model' });
    const small = within(models).getByRole('row', { name: /claude-demo-small/ });
    expect(small).toHaveTextContent('900');
    expect(small).toHaveTextContent('—');
    expect(screen.getByText(/Cache reads are 66\.9% of all input tokens/)).toBeInTheDocument();
  });

  it('computes the daily accept rate only for days with decisions', () => {
    expect(dailyAcceptRate(claudeCode())).toEqual([{ date: '2026-09-28', acceptRate: 90 }]);
    expect(terminalLabel('some-new-terminal')).toBe('some-new-terminal');
  });

  it('shows em dashes and empty notes when nothing was reported', () => {
    open({
      claudeCode: claudeCode({
        daily: [],
        byTerminal: [],
        byModel: [],
        estimatedCost: null,
        cacheReadShare: null,
        totals: { ...claudeCode().totals, accepted: 0, rejected: 0, acceptRate: null },
      }),
    });
    expect(
      screen.getByText('No Claude Code activity was reported in the collected period.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No model usage was reported.')).toBeInTheDocument();
    expect(screen.getAllByRole('definition').at(-1)).toHaveTextContent('—');
  });

  it('explains how to enable the source when the dataset is absent', () => {
    open({});
    expect(
      screen.getByRole('heading', { level: 2, name: 'Claude Code activity is not collected' }),
    ).toBeInTheDocument();
    expect(screen.getByText('sources.claudeCode.enabled')).toBeInTheDocument();
    expect(screen.getByText('ANTHROPIC_CONSOLE_ADMIN_API_KEY')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('term')).not.toBeInTheDocument();
  });

  it('names the reason when the source is enabled but unavailable or failed', () => {
    const { unmount } = open({ coverage: coverage('unavailable', 'No Console Admin API key') });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Claude Code activity was not collected (No Console Admin API key).',
    );
    unmount();
    open({ coverage: coverage('error', 'schema drift') });
    expect(screen.getByRole('alert')).toHaveTextContent('schema drift');
  });
});
