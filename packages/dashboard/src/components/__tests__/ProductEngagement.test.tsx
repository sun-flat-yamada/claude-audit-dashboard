import type { DashboardEngagement } from '@claude-audit/core/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { engagementTitle, highlights, windowDays } from '../../lib/engagement-view';
import { ProductEngagementSection } from '../ProductEngagement';

const engagement = (over: Partial<DashboardEngagement> = {}): DashboardEngagement => ({
  window: { from: '2026-07-01T00:00:00.000Z', to: '2026-09-29T12:00:00.000Z' },
  members: 36,
  products: [
    {
      product: 'chat',
      label: 'Chat',
      activeMembers: 34,
      messages: 14554,
      sessions: null,
      counters: [
        { key: 'conversations', label: 'Conversations', value: 2219 },
        { key: 'filesUploaded', label: 'Files uploaded', value: null },
      ],
    },
    {
      product: 'claude_code',
      label: 'Claude Code',
      activeMembers: 13,
      messages: null,
      sessions: 1724,
      counters: [{ key: 'commits', label: 'Commits', value: 1168 }],
    },
  ],
  claudeCode: {
    sessions: 1724,
    commits: 1168,
    pullRequests: 347,
    addedLines: 227501,
    removedLines: 76245,
    accepted: 98,
    rejected: 12,
    acceptRate: 89.1,
    tools: [
      { tool: 'edit', label: 'Edit', accepted: 90, rejected: 10, acceptRate: 90 },
      { tool: 'notebookEdit', label: 'NotebookEdit', accepted: 0, rejected: 0, acceptRate: null },
    ],
  },
  webSearches: 1719,
  ...over,
});

describe('Product engagement (AN-3)', () => {
  it('titles the card with the roll-up window and lists products in a table', () => {
    render(<ProductEngagementSection engagement={engagement()} />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Product engagement (90 days)' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/2026-07-01 – 2026-09-29/)).toBeInTheDocument();
    const chat = screen.getByRole('rowheader', { name: 'Chat' }).closest('tr');
    if (!chat) throw new Error('row expected');
    expect(
      within(chat)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['34 / 36', '14,554', '—', '2,219 conversations']);
  });

  it('shows Claude Code lines, commits and the suggestion accept rate per tool', () => {
    render(<ProductEngagementSection engagement={engagement()} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByText('Lines added').nextSibling?.textContent).toBe('227,501');
    expect(screen.getByText('Suggestion accept rate').nextSibling?.textContent).toBe('89.1%');
    expect(screen.getByText('90.0% · 90 of 100')).toBeInTheDocument();
    expect(screen.getByText('— · 0 of 0')).toBeInTheDocument();
    expect(screen.getByText('View as table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Accept rate' })).toBeInTheDocument();
  });

  it('omits the Claude Code panel without Claude Code data', () => {
    render(<ProductEngagementSection engagement={engagement({ claudeCode: null })} />);
    expect(screen.queryByRole('heading', { name: 'Claude Code' })).toBeNull();
  });

  it('renders nothing for a dashboard.json without engagement', () => {
    const { container } = render(<ProductEngagementSection engagement={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('engagement view helpers', () => {
  it('derives whole days and falls back without a window', () => {
    expect(windowDays({ from: '2026-07-01T00:00:00Z', to: '2026-09-29T12:00:00Z' })).toBe(90);
    expect(windowDays(null)).toBeNull();
    expect(engagementTitle(null)).toBe('Product engagement');
  });

  it('skips counters nobody reported', () => {
    expect(
      highlights([
        { key: 'a', label: 'Projects created', value: 3 },
        { key: 'b', label: 'Files uploaded', value: null },
      ]),
    ).toBe('3 projects created');
  });
});
