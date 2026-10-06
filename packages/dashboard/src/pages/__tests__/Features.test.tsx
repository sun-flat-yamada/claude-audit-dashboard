import type { DashboardFeatures, DashboardView } from '@claude-audit/core/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  callSplits,
  headlineStats,
  moreText,
  shareStatusText,
  writeShare,
  type ConnectorItem,
} from '../../lib/features-view';
import { Features } from '../Features';

const products = {
  chatConversations: 30,
  claudeCodeSessions: null,
  coworkSessions: 4,
  officeSessions: null,
};

const connector = (over: Partial<ConnectorItem> = {}): ConnectorItem => ({
  key: 'github',
  label: 'github',
  users: 15,
  readCalls: 300,
  writeCalls: 100,
  unclassifiedCalls: 100,
  ...products,
  ...over,
});

const features = (over: Partial<DashboardFeatures> = {}): DashboardFeatures => ({
  window: { from: '2026-09-05T00:00:00.000Z', to: '2026-10-05T12:00:00.000Z' },
  skills: {
    total: 25,
    items: [
      {
        key: 'skill_01Demo',
        label: 'Example Brand Voice',
        users: 21,
        invocations: 264,
        shareStatus: 'organization',
        ...products,
      },
      { key: 'xlsx', label: 'xlsx', users: 1, invocations: null, shareStatus: null, ...products },
    ],
  },
  connectors: {
    total: 2,
    items: [
      connector(),
      connector({
        key: 'mcpsrv_01',
        label: 'Example Wiki',
        users: 9,
        readCalls: null,
        writeCalls: null,
        unclassifiedCalls: null,
      }),
    ],
    calls: { read: 300, write: 100, unclassified: 100 },
  },
  plugins: {
    total: 1,
    items: [
      {
        key: 'code-review@example-marketplace',
        label: 'code-review',
        users: 13,
        invocations: 412,
        installs: null,
        claudeCodeSessions: 286,
        coworkSessions: null,
      },
    ],
  },
  projects: {
    total: 1,
    items: [
      {
        key: 'claude_proj_demo',
        label: 'Example Onboarding Handbook',
        users: 18,
        messages: 642,
        conversations: 121,
      },
    ],
  },
  ...over,
});

const coverage = (status: string, reason: string | null = null) =>
  ['skillUsage', 'connectorUsage', 'pluginUsage', 'chatProjectUsage'].map((dataset) => ({
    dataset,
    status,
    source: null,
    reason,
    count: null,
    asOf: null,
  }));

const open = (over: Partial<DashboardView>) =>
  render(<Features view={{ coverage: [], ...over } as unknown as DashboardView} />);

describe('Skills and connectors page (AN-6)', () => {
  it('shows the counts, ranked lists with table twins and the connector call split', () => {
    open({ features: features() });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Skills, connectors, plugins and projects' }),
    ).toBeInTheDocument();
    expect(screen.getByText('2026-09-05 – 2026-10-05', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('term').map((t) => t.textContent)).toEqual([
      'Skills used',
      'Connectors used',
      'Plugins used',
      'Active chat projects',
      'Connector write share',
    ]);
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual([
      '25',
      '2',
      '1',
      '1',
      '20.0%',
    ]);
    for (const title of [
      'Top skills',
      'Top connectors',
      'Connector calls by kind',
      'Top plugins',
      'Top chat projects',
    ])
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    expect(screen.getByText('21 users · 264 uses')).toBeInTheDocument();
    expect(screen.getByText('1 user')).toBeInTheDocument();
    expect(screen.getByText('18 users · 642 messages')).toBeInTheDocument();
    expect(screen.getByText('Showing the top 2 of 25.')).toBeInTheDocument();
    // Only the connector with a stated split gets a bar; its label names every part.
    const split = screen.getByRole('img', { name: /^github, 500 calls/ });
    expect(split).toHaveAccessibleName(
      'github, 500 calls: Read-only 300 (60.0%), Write 100 (20.0%), Unclassified 100 (20.0%)',
    );
    expect(screen.queryByRole('img', { name: /^Example Wiki/ })).not.toBeInTheDocument();
    const skills = screen.getByRole('heading', { level: 2, name: 'Top skills' }).closest('section');
    expect(within(skills as HTMLElement).getByText('Organization')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows dashes and notes when a dataset was not collected or had no rows', () => {
    open({
      features: features({
        skills: null,
        connectors: { total: 0, items: [], calls: null },
        plugins: { total: 0, items: [] },
      }),
    });
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual([
      '—',
      '0',
      '0',
      '1',
      '—',
    ]);
    expect(screen.getByText('No connector was used in the period.')).toBeInTheDocument();
    expect(screen.getByText('No plugin was used in the period.')).toBeInTheDocument();
    expect(screen.getByText('Not collected in this snapshot.')).toBeInTheDocument();
    expect(
      screen.getByText('The API reported no read / write split for this period.'),
    ).toBeInTheDocument();
  });

  it('explains how to enable the source when the datasets are absent', () => {
    open({});
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Skill, connector, plugin and project adoption is not collected',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('sources.featureUsage.enabled')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('term')).not.toBeInTheDocument();
  });

  it('names the reason once when the source is enabled but unavailable or failed', () => {
    const { unmount } = open({ coverage: coverage('unavailable', 'HTTP 403 permission_error') });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Not collected: skillUsage, connectorUsage, pluginUsage, chatProjectUsage (HTTP 403 permission_error).',
    );
    unmount();
    open({ coverage: coverage('error', 'schema drift') });
    expect(screen.getByRole('alert')).toHaveTextContent('schema drift');
  });

  it('computes the helpers for partial data', () => {
    expect(writeShare(features({ connectors: null }))).toBeNull();
    expect(
      writeShare(
        features({
          connectors: { total: 0, items: [], calls: { read: 0, write: 0, unclassified: 0 } },
        }),
      ),
    ).toBeNull();
    expect(headlineStats(features()).at(-1)?.value).toBe('20.0%');
    expect(moreText({ total: 1, items: [1] })).toBeNull();
    expect(shareStatusText('team')).toBe('team');
    const many = [
      connector({ key: 'a', label: 'a', readCalls: 1, writeCalls: 0, unclassifiedCalls: 0 }),
      connector({ key: 'b', label: 'b', readCalls: 0, writeCalls: 0, unclassifiedCalls: 0 }),
      connector({ key: 'c', label: 'c', readCalls: 5, writeCalls: null, unclassifiedCalls: null }),
    ];
    expect(callSplits(many).map((s) => [s.key, s.total])).toEqual([
      ['c', 5],
      ['a', 1],
    ]);
  });
});
