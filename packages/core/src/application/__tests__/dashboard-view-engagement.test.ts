import { describe, expect, it } from 'vitest';
import { NOW, daysAgo, snapshot } from '../../__tests__/fixtures.js';
import { dashboardViewSchema, type DashboardView } from '../../contracts/dashboard-view.js';
import type { MemberActivity, MemberEngagement } from '../../domain/model/entities.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import { buildDashboardView } from '../presenters/dashboard-view.js';

const view = (snap: AuditSnapshot): DashboardView =>
  buildDashboardView({
    now: NOW,
    title: 'Audit',
    source: 'demo',
    maskPii: true,
    snapshot: snap,
    report: null,
    history: [],
    insights: [],
  });

const row = (id: string, engagement?: MemberEngagement): MemberActivity => ({
  userId: id,
  email: `${id}@example.com`,
  active: true,
  lastActiveOn: '2026-09-29',
  ...(engagement ? { engagement } : {}),
});

const chat = (messages: number, conversations: number | null) => ({
  messages,
  conversations,
  projectsCreated: 1,
  artifactsCreated: 2,
  filesUploaded: null,
  connectorCalls: 0,
  thinkingMessages: 0,
});

const code = (
  edit: [number, number],
  write: [number, number],
  overrides: Partial<NonNullable<MemberEngagement['claudeCode']>> = {},
) => ({
  sessions: 4,
  commits: 3,
  pullRequests: 1,
  addedLines: 500,
  removedLines: 120,
  artifactsCreated: 0,
  tools: {
    edit: { accepted: edit[0], rejected: edit[1] },
    write: { accepted: write[0], rejected: write[1] },
  },
  ...overrides,
});

const window = { from: daysAgo(90), to: NOW.toISOString() };

const snap = snapshot(
  {
    memberActivity: [
      row('a', { chat: chat(40, 6), claudeCode: code([90, 10], [8, 2]), webSearches: 3 }),
      row('b', { chat: chat(10, null), webSearches: null }),
      row('c', {
        chat: chat(0, 0),
        claudeCode: code([0, 0], [0, 0], {
          sessions: null,
          commits: 0,
          pullRequests: 0,
          addedLines: 0,
          removedLines: 0,
        }),
        cowork: {
          messages: 5,
          sessions: 2,
          actions: 30,
          dispatchTurns: 1,
          skillCalls: 0,
          artifactsCreated: 1,
        },
      }),
      row('d'),
    ],
  },
  { memberActivity: { status: 'ok', window } },
);

describe('dashboard view product engagement (AN-3)', () => {
  it('sums the main counters per product and counts members with any activity', () => {
    const engagement = view(snap).engagement;
    expect(engagement?.window).toEqual(window);
    expect(engagement?.members).toBe(3);
    expect(engagement?.webSearches).toBe(3);
    const chatRow = engagement?.products.find((p) => p.product === 'chat');
    expect(chatRow).toMatchObject({
      label: 'Chat',
      activeMembers: 3,
      messages: 50,
      sessions: null,
    });
    expect(chatRow?.counters).toContainEqual({
      key: 'conversations',
      label: 'Conversations',
      value: 6,
    });
    expect(chatRow?.counters).toContainEqual({
      key: 'filesUploaded',
      label: 'Files uploaded',
      value: null,
    });
  });

  it('orders products by active members, ties in catalog order', () => {
    const products = view(snap).engagement?.products ?? [];
    expect(products.map((p) => [p.product, p.activeMembers])).toEqual([
      ['chat', 3],
      ['claude_code', 1],
      ['cowork', 1],
    ]);
    expect(products.find((p) => p.product === 'claude_code')?.messages).toBeNull();
  });

  it('reports Claude Code lines, commits and the suggestion accept rate per tool', () => {
    const cc = view(snap).engagement?.claudeCode;
    expect(cc).toMatchObject({
      sessions: 4,
      commits: 3,
      pullRequests: 1,
      addedLines: 500,
      removedLines: 120,
      accepted: 98,
      rejected: 12,
      acceptRate: 89.1,
    });
    expect(cc?.tools).toEqual([
      { tool: 'edit', label: 'Edit', accepted: 90, rejected: 10, acceptRate: 90 },
      { tool: 'write', label: 'Write', accepted: 8, rejected: 2, acceptRate: 80 },
    ]);
  });

  it('gives a null accept rate when no proposal was decided', () => {
    const quiet = snapshot({
      memberActivity: [row('c', { claudeCode: code([0, 0], [0, 0]) })],
    });
    const cc = view(quiet).engagement?.claudeCode;
    expect(cc?.acceptRate).toBeNull();
    expect(cc?.tools.every((t) => t.acceptRate === null)).toBe(true);
  });

  it('omits the field without engagement rows or without collected member activity', () => {
    expect(view(snapshot({ memberActivity: [row('d')] }))).not.toHaveProperty('engagement');
    const missing = snapshot(
      { memberActivity: [row('a', { chat: chat(1, 1) })] },
      { memberActivity: { status: 'unavailable', reason: 'no key' } },
    );
    expect(view(missing)).not.toHaveProperty('engagement');
  });

  it('accepts a dashboard.json written before engagement existed', () => {
    const current = view(snap);
    const legacy: Partial<DashboardView> = { ...current };
    delete legacy.engagement;
    const parsed = dashboardViewSchema.parse(JSON.parse(JSON.stringify(legacy)));
    expect(parsed.engagement).toBeUndefined();
    expect(dashboardViewSchema.parse(current)).toEqual(current);
  });
});
