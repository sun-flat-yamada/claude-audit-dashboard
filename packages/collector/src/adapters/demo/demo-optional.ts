import type {
  ClaudeCodeActivity,
  ConsoleApiKey,
  ConsoleCostRow,
  ConsoleUsageRow,
  ConsoleWorkspace,
  DatasetCollector,
  DatasetMap,
  OptionalDatasetName,
} from '@claude-audit/core';
import { addDays, round, startOfUtcDay, toIsoDate } from '@claude-audit/core';

/**
 * Deterministic synthetic data of the OPTIONAL sources (B4), used only by the
 * `optional-sources` demo profile and by tests. The default `pnpm demo` profile never calls it,
 * so `data/sample/` is unchanged. Names are fictional, every address uses example.com.
 */

const WORKSPACES = [
  { id: 'wrkspc_demo_production', name: 'Example Production' },
  { id: 'wrkspc_demo_staging', name: 'Example Staging' },
  { id: 'wrkspc_demo_sandbox', name: 'Example Sandbox' },
] as const;

const MODELS = ['claude-demo-large', 'claude-demo-small'] as const;

const ago = (now: Date, days: number): string => addDays(now, -days).toISOString();

const workspaces = (now: Date): ConsoleWorkspace[] =>
  WORKSPACES.map((w, i) => ({
    ...w,
    createdAt: ago(now, 300 - i * 40),
    archivedAt: i === 2 ? ago(now, 20) : null,
  }));

const apiKeys = (now: Date): ConsoleApiKey[] => [
  {
    id: 'apikey_demo_console_prod',
    name: 'production-backend',
    status: 'active',
    workspaceId: 'wrkspc_demo_production',
    createdAt: ago(now, 200),
    createdBy: 'user_demo_001',
  },
  {
    id: 'apikey_demo_console_ci',
    name: 'ci-evaluation',
    status: 'active',
    workspaceId: 'wrkspc_demo_staging',
    createdAt: ago(now, 90),
    createdBy: 'user_demo_002',
  },
  {
    id: 'apikey_demo_console_default',
    name: 'default-workspace-key',
    status: 'active',
    workspaceId: null,
    createdAt: ago(now, 410),
    createdBy: null,
  },
  {
    id: 'apikey_demo_console_old',
    name: 'retired-experiment',
    status: 'archived',
    workspaceId: 'wrkspc_demo_sandbox',
    createdAt: ago(now, 260),
    createdBy: 'user_demo_002',
  },
];

/** Days from the range start up to and including `now`'s day (UTC). */
function daysOf(start: Date, now: Date): string[] {
  const first = startOfUtcDay(start);
  const count = Math.round((startOfUtcDay(now).getTime() - first.getTime()) / 86_400_000);
  return Array.from({ length: count + 1 }, (_, i) => toIsoDate(addDays(first, i)));
}

/** A repeatable pseudo-random factor in [0.6, 1.4) from the day index and a series number. */
const wave = (day: number, series: number): number =>
  0.6 + (((day * 37 + series * 11) % 17) / 17) * 0.8;

/** Workspaces with traffic: the default workspace (null id) and two active ones. */
const TRAFFIC = [
  { id: WORKSPACES[0].id, scale: 1, searches: 1 },
  { id: WORKSPACES[1].id, scale: 0.3, searches: 0 },
  { id: null, scale: 0.12, searches: 0.4 },
] as const;

/** Console models with a daily base of uncached input tokens and a price per million tokens. */
const CONSOLE_MODELS = [
  { model: 'claude-demo-large', base: 450_000, input: 15, output: 75 },
  { model: 'claude-demo-medium', base: 2_400_000, input: 3, output: 15 },
  { model: 'claude-demo-small', base: 4_100_000, input: 0.8, output: 4 },
] as const;

type ConsoleModel = (typeof CONSOLE_MODELS)[number];

/** Weekends carry about a third of a weekday's traffic. */
const weekday = (date: string): number => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? 0.35 : 1;
};

/** One (day, workspace, model) combination; `f` is its traffic factor, `w` the workspace index. */
interface Cell {
  date: string;
  workspaceId: string | null;
  f: number;
  m: ConsoleModel;
  w: number;
}

function cells(start: Date, now: Date): Cell[] {
  return daysOf(start, now).flatMap((date, day) =>
    TRAFFIC.flatMap((t, w) =>
      CONSOLE_MODELS.map((m, i) => ({
        date,
        workspaceId: t.id,
        f: wave(day, w * 3 + i) * weekday(date) * t.scale,
        m,
        w,
      })),
    ),
  );
}

/** Web search requests of one cell (the medium model in searching workspaces only). */
const searches = (c: Cell): number =>
  c.m.model === 'claude-demo-medium' ? Math.round(160 * c.f * (TRAFFIC[c.w]?.searches ?? 0)) : 0;

function usageRow(c: Cell): ConsoleUsageRow {
  const uncached = Math.round(c.m.base * c.f);
  return {
    date: c.date,
    workspaceId: c.workspaceId,
    model: c.m.model,
    uncachedInputTokens: uncached,
    cacheReadInputTokens: Math.round(uncached * (1.1 + (c.f % 0.5))),
    cacheCreationInputTokens: Math.round(uncached * 0.12),
    outputTokens: Math.round(uncached * 0.22),
    webSearchRequests: searches(c),
  };
}

function usage(start: Date, now: Date): ConsoleUsageRow[] {
  return cells(start, now).map(usageRow);
}

/** Token cost of a usage row (cache reads at 10%, cache writes at 125% of the input price). */
function tokenCost(row: ConsoleUsageRow, m: ConsoleModel): number {
  const input =
    row.uncachedInputTokens + row.cacheReadInputTokens * 0.1 + row.cacheCreationInputTokens * 1.25;
  return (input * m.input + row.outputTokens * m.output) / 1_000_000;
}

function costRows(c: Cell): ConsoleCostRow[] {
  const row = usageRow(c);
  const base = { date: c.date, workspaceId: c.workspaceId, model: c.m.model, currency: 'USD' };
  const rows: ConsoleCostRow[] = [
    { ...base, costType: 'tokens', amount: round(tokenCost(row, c.m)) },
  ];
  if (row.webSearchRequests > 0)
    rows.push({ ...base, costType: 'web_search', amount: round(row.webSearchRequests * 0.01) });
  return rows;
}

/** Code execution container hours of the production workspace (not model-specific). */
const codeExecution = (date: string, day: number): ConsoleCostRow => ({
  date,
  workspaceId: WORKSPACES[0].id,
  model: null,
  costType: 'code_execution',
  amount: round(1.8 * wave(day, 13) * weekday(date)),
  currency: 'USD',
});

function cost(start: Date, now: Date): ConsoleCostRow[] {
  return [
    ...cells(start, now).flatMap(costRows),
    ...daysOf(start, now).map((date, day) => codeExecution(date, day)),
  ];
}

/** Synthetic Claude Code users: address, terminal, activity scale and share of the small model. */
const PEOPLE = [
  { name: 'alice.engineer', terminal: 'vscode', scale: 1.3, small: 0.1 },
  { name: 'bob.analyst', terminal: 'iTerm.app', scale: 0.6, small: 0.5 },
  { name: 'carol.designer', terminal: 'vscode', scale: 0.4, small: 0.3 },
  { name: 'dave.engineer', terminal: 'jetbrains', scale: 1.1, small: 0.2 },
  { name: 'erin.platform', terminal: 'tmux', scale: 0.9, small: 0.15 },
  { name: 'frank.data', terminal: 'cursor', scale: 0.7, small: 0.4 },
] as const;

type Person = (typeof PEOPLE)[number];

/** Token and cost usage of one actor-day split between the two demo models. */
function codeModels(f: number, small: number): ClaudeCodeActivity['models'] {
  const usageOf = (model: string, share: number, price: number) => ({
    model,
    inputTokens: Math.round(90_000 * f * share),
    outputTokens: Math.round(22_000 * f * share),
    cacheReadTokens: Math.round(310_000 * f * share * (0.7 + (f % 0.3))),
    cacheCreationTokens: Math.round(24_000 * f * share),
    estimatedCost: round(price * f * share),
  });
  return [usageOf(MODELS[0], 1 - small, 3.4), usageOf(MODELS[1], small, 0.6)];
}

/** One person's day, or null on a day off (a different weekday-like gap per person). */
function personDay(
  date: string,
  day: number,
  p: number,
  person: Person,
): ClaudeCodeActivity | null {
  if ((day + p * 2) % 7 === 6) return null;
  const f = wave(day, p) * person.scale;
  return {
    date,
    actorKind: 'user',
    actor: `${person.name}@example.com`,
    customerType: 'subscription',
    terminalType: person.terminal,
    sessions: Math.max(1, Math.round(5 * f)),
    linesAdded: Math.round(240 * f),
    linesRemoved: Math.round(70 * f),
    commits: Math.round(3 * f),
    pullRequests: Math.round(f * 0.8),
    toolAccepted: Math.round(40 * f),
    toolRejected: Math.round(4 * f * (2 - wave(day, p + 3))),
    models: codeModels(f, person.small),
  };
}

/** An automation key's day (non-interactive, small model only); some keys skip days. */
function apiKeyDay(date: string, day: number, key: string, every: number): ClaudeCodeActivity[] {
  if (day % every !== 0) return [];
  const f = wave(day, 9);
  return [
    {
      date,
      actorKind: 'api',
      actor: key,
      customerType: 'api',
      terminalType: 'non-interactive',
      sessions: Math.round(3 * f),
      linesAdded: Math.round(35 * f),
      linesRemoved: Math.round(12 * f),
      commits: 0,
      pullRequests: 0,
      toolAccepted: Math.round(8 * f),
      toolRejected: 1,
      models: codeModels(f * 0.2, 1).slice(1),
    },
  ];
}

function claudeCode(now: Date, lookbackDays: number): ClaudeCodeActivity[] {
  const dates = daysOf(addDays(now, -lookbackDays), now);
  return dates.flatMap((date, day) => [
    ...PEOPLE.map((person, p) => personDay(date, day, p, person)).filter(
      (row): row is ClaudeCodeActivity => row !== null,
    ),
    ...apiKeyDay(date, day, 'ci-code-review-bot', 1),
    ...apiKeyDay(date, day, 'nightly-refactor-job', 2),
  ]);
}

const fixed = <K extends OptionalDatasetName>(
  dataset: K,
  source: string,
  items: (now: Date, start: Date) => DatasetMap[K],
  lookbackDays: number,
): DatasetCollector<K> => ({
  dataset,
  source,
  collect: async ({ now }) => {
    const start = addDays(startOfUtcDay(now), -lookbackDays);
    return {
      items: items(now, start),
      window: { from: start.toISOString(), to: now.toISOString() },
    };
  },
});

/** Demo equivalents of the optional collectors (all five datasets). */
export function createDemoOptionalCollectors(): DatasetCollector[] {
  return [
    fixed('consoleWorkspaces', 'demo:consoleWorkspaces', (now) => workspaces(now), 30),
    fixed('consoleApiKeys', 'demo:consoleApiKeys', (now) => apiKeys(now), 30),
    fixed('consoleUsage', 'demo:consoleUsage', (now, start) => usage(start, now), 30),
    fixed('consoleCost', 'demo:consoleCost', (now, start) => cost(start, now), 30),
    fixed('claudeCodeActivity', 'demo:claudeCodeActivity', (now) => claudeCode(now, 7), 7),
  ];
}
