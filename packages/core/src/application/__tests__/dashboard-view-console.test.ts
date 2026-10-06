import { describe, expect, it } from 'vitest';
import { NOW, daysAgo, snapshot } from '../../__tests__/fixtures.js';
import { dashboardViewSchema, type DashboardView } from '../../contracts/dashboard-view.js';
import type {
  ConsoleApiKey,
  ConsoleCostRow,
  ConsoleUsageRow,
  ConsoleWorkspace,
} from '../../domain/model/optional-entities.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import { consoleView, dominantCurrency } from '../presenters/dashboard-console.js';
import { buildDashboardView } from '../presenters/dashboard-view.js';

const view = (snap: AuditSnapshot): DashboardView =>
  buildDashboardView({
    now: NOW,
    title: 'Audit',
    source: 'demo',
    maskPii: false,
    snapshot: snap,
    report: null,
    history: [],
    insights: [],
  });

const WINDOW = { from: daysAgo(30), to: NOW.toISOString() };

const WORKSPACES: ConsoleWorkspace[] = [
  { id: 'wrkspc_prod', name: 'Example Production', createdAt: null, archivedAt: null },
  { id: 'wrkspc_old', name: 'Example Sandbox', createdAt: null, archivedAt: daysAgo(3) },
];

const KEYS: ConsoleApiKey[] = [
  {
    id: 'apikey_secret_id_1',
    name: 'production-backend',
    status: 'active',
    workspaceId: 'wrkspc_prod',
    createdAt: null,
    createdBy: 'user_creator_1',
  },
  {
    id: 'apikey_secret_id_2',
    name: 'ci-evaluation',
    status: 'active',
    workspaceId: null,
    createdAt: null,
    createdBy: null,
  },
  {
    id: 'apikey_secret_id_3',
    name: 'retired-experiment',
    status: 'archived',
    workspaceId: 'wrkspc_old',
    createdAt: null,
    createdBy: 'user_creator_2',
  },
];

const cost = (over: Partial<ConsoleCostRow> = {}): ConsoleCostRow => ({
  date: '2026-09-28',
  workspaceId: 'wrkspc_prod',
  model: 'claude-demo-large',
  costType: 'tokens',
  amount: 10,
  currency: 'USD',
  ...over,
});

const usage = (over: Partial<ConsoleUsageRow> = {}): ConsoleUsageRow => ({
  date: '2026-09-28',
  workspaceId: 'wrkspc_prod',
  model: 'claude-demo-large',
  uncachedInputTokens: 1000,
  cacheReadInputTokens: 3000,
  cacheCreationInputTokens: 0,
  outputTokens: 400,
  webSearchRequests: 2,
  ...over,
});

const COST: ConsoleCostRow[] = [
  cost(),
  cost({ date: '2026-09-29', amount: 20 }),
  cost({ date: '2026-09-29', workspaceId: null, model: 'claude-demo-small', amount: 5 }),
  cost({ date: '2026-09-29', costType: 'web_search', model: null, amount: 5 }),
  cost({ date: '2026-09-29', workspaceId: 'wrkspc_gone', amount: 10 }),
];

const USAGE: ConsoleUsageRow[] = [
  usage(),
  usage({ date: '2026-09-29', workspaceId: null, cacheCreationInputTokens: 1000 }),
];

const input = (over: Partial<Parameters<typeof consoleView>[0]> = {}) => ({
  usage: USAGE,
  cost: COST,
  workspaces: WORKSPACES,
  apiKeys: KEYS,
  window: WINDOW,
  ...over,
});

const collected = (names: string[]) =>
  snapshot(
    {
      consoleUsage: USAGE,
      consoleCost: COST,
      consoleWorkspaces: WORKSPACES,
      consoleApiKeys: KEYS,
    },
    Object.fromEntries(names.map((n) => [n, { status: 'ok', count: 1, window: WINDOW }])),
  );

const ALL = ['consoleUsage', 'consoleCost', 'consoleWorkspaces', 'consoleApiKeys'];

describe('Console usage and cost aggregate (AN-5)', () => {
  it('sums the daily cost in major units with the token types of the day', () => {
    const c = consoleView(input());
    expect(c.currency).toBe('USD');
    expect(c.totalCost).toBe(50);
    expect(c.daily).toEqual([
      {
        date: '2026-09-28',
        cost: 10,
        uncachedInputTokens: 1000,
        cacheReadInputTokens: 3000,
        cacheCreationInputTokens: 0,
        outputTokens: 400,
      },
      {
        date: '2026-09-29',
        cost: 40,
        uncachedInputTokens: 1000,
        cacheReadInputTokens: 3000,
        cacheCreationInputTokens: 1000,
        outputTokens: 400,
      },
    ]);
  });

  it('keeps one currency: the dominant one, never a mix', () => {
    const mixed = [...COST, cost({ currency: 'EUR', amount: 999 })];
    const c = consoleView(input({ cost: mixed }));
    expect(c.currency).toBe('USD');
    expect(c.totalCost).toBe(50);
    expect(dominantCurrency([cost({ currency: 'JPY' })])).toBe('JPY');
    expect(dominantCurrency([])).toBe('USD');
  });

  it('resolves workspace names, the default workspace and unknown ids', () => {
    const c = consoleView(input());
    expect(c.byWorkspace).toEqual([
      { key: 'wrkspc_prod', label: 'Example Production', value: 35, percent: 70 },
      { key: 'wrkspc_gone', label: 'wrkspc_gone', value: 10, percent: 20 },
      { key: 'default', label: 'Default workspace', value: 5, percent: 10 },
    ]);
    const unnamed = consoleView(input({ workspaces: null }));
    expect(unnamed.byWorkspace[0]?.label).toBe('wrkspc_prod');
  });

  it('splits spend by model and cost type', () => {
    const c = consoleView(input());
    expect(c.byModel.map((s) => [s.key, s.value, s.percent])).toEqual([
      ['claude-demo-large', 40, 80],
      ['(unattributed)', 5, 10],
      ['claude-demo-small', 5, 10],
    ]);
    expect(c.byCostType.map((s) => [s.key, s.value])).toEqual([
      ['tokens', 45],
      ['web_search', 5],
    ]);
  });

  it('totals the token types, the cache read share and web searches', () => {
    const c = consoleView(input());
    expect(c.tokens).toEqual({
      uncachedInput: 2000,
      cacheRead: 6000,
      cacheWrite: 1000,
      output: 800,
    });
    // 6,000 cache reads of 2,000 + 6,000 + 1,000 input tokens.
    expect(c.cacheReadShare).toBe(66.7);
    expect(c.webSearchRequests).toBe(4);
  });

  it('counts workspaces and keys without publishing names, ids or creators', () => {
    const c = consoleView(input());
    expect(c.workspaces).toEqual({ active: 1, archived: 1 });
    expect(c.apiKeys).toEqual([
      { status: 'active', count: 2 },
      { status: 'archived', count: 1 },
    ]);
    const text = JSON.stringify(view(collected(ALL)).console);
    for (const secret of ['apikey_', 'production-backend', 'ci-evaluation', 'user_creator'])
      expect(text, secret).not.toContain(secret);
  });

  it('gives zeros, empty lists and null rates when there is no data', () => {
    const c = consoleView(input({ usage: [], cost: [], workspaces: null, apiKeys: null }));
    expect(c).toMatchObject({
      currency: 'USD',
      totalCost: 0,
      daily: [],
      byModel: [],
      byWorkspace: [],
      byCostType: [],
      cacheReadShare: null,
      webSearchRequests: 0,
      workspaces: null,
      apiKeys: null,
    });
  });

  it('is attached when usage or cost was collected, with null counts for missing datasets', () => {
    expect(view(snapshot()).console).toBeUndefined();
    expect(view(collected(['consoleWorkspaces', 'consoleApiKeys'])).console).toBeUndefined();
    const costOnly = view(collected(['consoleCost'])).console;
    expect(costOnly?.totalCost).toBe(50);
    expect(costOnly?.tokens.uncachedInput).toBe(0);
    expect(costOnly?.workspaces).toBeNull();
    expect(costOnly?.apiKeys).toBeNull();
    expect(costOnly?.byWorkspace.find((s) => s.key === 'wrkspc_prod')?.label).toBe('wrkspc_prod');
    const built = view(collected(ALL));
    expect(built.console?.window).toEqual(WINDOW);
    expect(dashboardViewSchema.parse(built).console).toEqual(built.console);
  });

  it('a v3 view written before the field still parses', () => {
    const older: Partial<DashboardView> = view(collected(ALL));
    delete older.console;
    expect(dashboardViewSchema.parse(older).console).toBeUndefined();
  });
});
