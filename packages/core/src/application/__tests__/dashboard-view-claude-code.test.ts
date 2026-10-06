import { describe, expect, it } from 'vitest';
import { NOW, daysAgo, snapshot } from '../../__tests__/fixtures.js';
import { dashboardViewSchema, type DashboardView } from '../../contracts/dashboard-view.js';
import type { ClaudeCodeActivity } from '../../domain/model/optional-entities.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import { acceptRate, claudeCodeView } from '../presenters/dashboard-claude-code.js';
import { buildDashboardView } from '../presenters/dashboard-view.js';

const view = (snap: AuditSnapshot, maskPii = true): DashboardView =>
  buildDashboardView({
    now: NOW,
    title: 'Audit',
    source: 'demo',
    maskPii,
    snapshot: snap,
    report: null,
    history: [],
    insights: [],
  });

const WINDOW = { from: daysAgo(7), to: NOW.toISOString() };

const row = (over: Partial<ClaudeCodeActivity> = {}): ClaudeCodeActivity => ({
  date: '2026-09-28',
  actorKind: 'user',
  actor: 'alice.engineer@example.com',
  customerType: 'api',
  terminalType: 'vscode',
  sessions: 2,
  linesAdded: 100,
  linesRemoved: 20,
  commits: 1,
  pullRequests: 1,
  toolAccepted: 9,
  toolRejected: 1,
  models: [
    {
      model: 'claude-demo-large',
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 3000,
      cacheCreationTokens: 0,
      estimatedCost: 1.25,
    },
  ],
  ...over,
});

const ROWS: ClaudeCodeActivity[] = [
  row(),
  row({ date: '2026-09-29' }),
  row({ date: '2026-09-29', actor: 'bob.analyst@example.com', terminalType: 'iTerm.app' }),
  row({
    date: '2026-09-29',
    actorKind: 'api',
    actor: 'ci-code-review-bot',
    terminalType: null,
    sessions: 1,
    toolAccepted: 0,
    toolRejected: 0,
    models: [
      {
        model: 'claude-demo-small',
        inputTokens: 500,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 500,
        estimatedCost: null,
      },
    ],
  }),
  row({ date: '2026-09-29', actor: null, terminalType: 'vscode', sessions: 1 }),
];

const collected = (rows: ClaudeCodeActivity[]) =>
  snapshot(
    { claudeCodeActivity: rows },
    { claudeCodeActivity: { status: 'ok', count: rows.length, window: WINDOW } },
  );

describe('Claude Code aggregate (AN-4)', () => {
  it('counts distinct actors per day and per kind, never rows', () => {
    const cc = claudeCodeView(ROWS, WINDOW);
    expect(cc.users).toBe(2);
    expect(cc.apiKeys).toBe(1);
    expect(cc.daily.map((d) => [d.date, d.actors, d.sessions])).toEqual([
      ['2026-09-28', 1, 2],
      ['2026-09-29', 3, 6],
    ]);
  });

  it('sums the totals and computes the suggestion accept rate', () => {
    const { totals } = claudeCodeView(ROWS, WINDOW);
    expect(totals).toEqual({
      sessions: 8,
      addedLines: 500,
      removedLines: 100,
      commits: 5,
      pullRequests: 5,
      accepted: 36,
      rejected: 4,
      acceptRate: 90,
    });
    expect(acceptRate(2, 1)).toBe(66.7);
    expect(acceptRate(0, 0)).toBeNull();
  });

  it('splits sessions by terminal and tokens and cost by model', () => {
    const cc = claudeCodeView(ROWS, WINDOW);
    expect(cc.byTerminal).toEqual([
      { terminal: 'vscode', sessions: 5, percent: 62.5 },
      { terminal: 'iTerm.app', sessions: 2, percent: 25 },
      { terminal: '(unknown)', sessions: 1, percent: 12.5 },
    ]);
    expect(cc.byModel.map((m) => [m.model, m.inputTokens, m.estimatedCost])).toEqual([
      ['claude-demo-large', 4000, 5],
      ['claude-demo-small', 500, null],
    ]);
    expect(cc.estimatedCost).toBe(5);
    // 12,000 cache reads of 4,500 + 12,000 + 500 input tokens.
    expect(cc.cacheReadShare).toBe(70.6);
  });

  it('gives null rates and empty lists when there is no activity', () => {
    const cc = claudeCodeView([], WINDOW);
    expect(cc).toMatchObject({
      users: 0,
      apiKeys: 0,
      daily: [],
      byTerminal: [],
      byModel: [],
      estimatedCost: null,
      cacheReadShare: null,
    });
    expect(cc.totals.acceptRate).toBeNull();
    expect(view(collected([])).claudeCode?.daily).toEqual([]);
  });

  it('is attached only when the dataset was collected', () => {
    expect(view(snapshot()).claudeCode).toBeUndefined();
    const unavailable = snapshot(
      { claudeCodeActivity: ROWS },
      { claudeCodeActivity: { status: 'unavailable', reason: 'no key' } },
    );
    expect(view(unavailable).claudeCode).toBeUndefined();
    const built = view(collected(ROWS));
    expect(built.claudeCode?.window).toEqual(WINDOW);
    expect(dashboardViewSchema.parse(built).claudeCode).toEqual(built.claudeCode);
  });

  it('publishes no e-mail address or API key name, even with masking off', () => {
    const text = JSON.stringify(view(collected(ROWS), false).claudeCode);
    for (const actor of ['alice.engineer', 'bob.analyst', 'example.com', 'ci-code-review-bot'])
      expect(text).not.toContain(actor);
    expect(text).not.toMatch(/linesAdded|toolAccepted|actorKind/);
  });

  it('a v3 view written before the field still parses', () => {
    const older: Partial<DashboardView> = view(collected(ROWS));
    delete older.claudeCode;
    expect(dashboardViewSchema.parse(older).claudeCode).toBeUndefined();
  });
});
