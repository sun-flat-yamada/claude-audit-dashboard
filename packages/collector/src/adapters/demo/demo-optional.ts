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

function usage(start: Date, now: Date): ConsoleUsageRow[] {
  return daysOf(start, now).flatMap((date, day) =>
    WORKSPACES.slice(0, 2).flatMap((workspace, w) =>
      MODELS.map((model, m): ConsoleUsageRow => {
        const f = wave(day, w * 2 + m);
        const scale = (m === 0 ? 1_200_000 : 2_600_000) * (w === 0 ? 1 : 0.35) * f;
        return {
          date,
          workspaceId: workspace.id,
          model,
          uncachedInputTokens: Math.round(scale),
          cacheReadInputTokens: Math.round(scale * 0.8),
          cacheCreationInputTokens: Math.round(scale * 0.1),
          outputTokens: Math.round(scale * 0.25),
          webSearchRequests: m === 0 ? Math.round(4 * f) : 0,
        };
      }),
    ),
  );
}

function cost(start: Date, now: Date): ConsoleCostRow[] {
  return daysOf(start, now).flatMap((date, day) =>
    WORKSPACES.slice(0, 2).flatMap((workspace, w) =>
      MODELS.map((model, m): ConsoleCostRow => {
        const f = wave(day, w * 2 + m + 5);
        return {
          date,
          workspaceId: workspace.id,
          model,
          costType: 'tokens',
          amount: round((m === 0 ? 42 : 11) * (w === 0 ? 1 : 0.35) * f),
          currency: 'USD',
        };
      }),
    ),
  );
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
