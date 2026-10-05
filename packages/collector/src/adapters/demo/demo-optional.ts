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

const PEOPLE = ['alice.engineer', 'bob.analyst', 'carol.designer', 'dave.engineer'] as const;

function claudeCode(now: Date, lookbackDays: number): ClaudeCodeActivity[] {
  const dates = daysOf(addDays(now, -lookbackDays), now);
  return dates.flatMap((date, day) => [
    ...PEOPLE.map((person, p): ClaudeCodeActivity => {
      const f = wave(day, p);
      return {
        date,
        actorKind: 'user',
        actor: `${person}@example.com`,
        customerType: 'api',
        terminalType: p % 2 === 0 ? 'vscode' : 'iTerm.app',
        sessions: Math.round(5 * f),
        linesAdded: Math.round(240 * f),
        linesRemoved: Math.round(70 * f),
        commits: Math.round(3 * f),
        pullRequests: Math.round(f),
        toolAccepted: Math.round(40 * f),
        toolRejected: Math.round(6 * (2 - f)),
        models: [
          {
            model: MODELS[0],
            inputTokens: Math.round(90_000 * f),
            outputTokens: Math.round(22_000 * f),
            cacheReadTokens: Math.round(310_000 * f),
            cacheCreationTokens: Math.round(24_000 * f),
            estimatedCost: round(3.4 * f),
          },
        ],
      };
    }),
    {
      date,
      actorKind: 'api',
      actor: 'ci-code-review-bot',
      customerType: 'api',
      terminalType: 'non-interactive',
      sessions: 2,
      linesAdded: 35,
      linesRemoved: 12,
      commits: 0,
      pullRequests: 0,
      toolAccepted: 8,
      toolRejected: 1,
      models: [
        {
          model: MODELS[1],
          inputTokens: 18_000,
          outputTokens: 4_000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          estimatedCost: 0.21,
        },
      ],
    },
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
