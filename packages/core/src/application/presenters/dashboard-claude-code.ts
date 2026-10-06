import type { DashboardClaudeCode } from '../../contracts/dashboard-view.js';
import type {
  ClaudeCodeActivity,
  ClaudeCodeModelUsage,
} from '../../domain/model/optional-entities.js';
import { groupBy, sortedByValue, sumBy, totalsBy } from '../../domain/util/collections.js';
import { percent, round } from '../../domain/util/numbers.js';

type Window = DashboardClaudeCode['window'];
type Counts = Omit<DashboardClaudeCode['totals'], 'acceptRate'>;
type ModelRow = DashboardClaudeCode['byModel'][number];

/** Key of rows that reported no terminal. */
export const UNKNOWN_TERMINAL = '(unknown)';

/** The estimate of the Claude Code Analytics API is in US dollars. */
const CURRENCY = 'USD';

const counts = (rows: readonly ClaudeCodeActivity[]): Counts => ({
  sessions: sumBy(rows, (r) => r.sessions),
  addedLines: sumBy(rows, (r) => r.linesAdded),
  removedLines: sumBy(rows, (r) => r.linesRemoved),
  commits: sumBy(rows, (r) => r.commits),
  pullRequests: sumBy(rows, (r) => r.pullRequests),
  accepted: sumBy(rows, (r) => r.toolAccepted),
  rejected: sumBy(rows, (r) => r.toolRejected),
});

/** Identity of an actor for distinct counts only; it never leaves this module. */
const actorKey = (r: ClaudeCodeActivity): string | null =>
  r.actor === null ? null : `${r.actorKind}:${r.actor}`;

/** Distinct actors among the rows (rows without an actor are not counted). */
const distinctActors = (rows: readonly ClaudeCodeActivity[]): number =>
  new Set(rows.map(actorKey).filter((k): k is string => k !== null)).size;

/** Accepted as a percent of accepted + rejected, null when there were no decisions. */
export const acceptRate = (accepted: number, rejected: number): number | null =>
  accepted + rejected === 0 ? null : percent(accepted, accepted + rejected);

function daily(rows: readonly ClaudeCodeActivity[]): DashboardClaudeCode['daily'] {
  return [...groupBy(rows, (r) => r.date)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => ({ date, actors: distinctActors(day), ...counts(day) }));
}

function byTerminal(rows: readonly ClaudeCodeActivity[]): DashboardClaudeCode['byTerminal'] {
  const sessions = totalsBy(
    rows,
    (r) => r.terminalType ?? UNKNOWN_TERMINAL,
    (r) => r.sessions,
  );
  const total = sumBy([...sessions.values()], (v) => v);
  return sortedByValue(sessions)
    .filter(([, value]) => value > 0)
    .map(([terminal, value]) => ({ terminal, sessions: value, percent: percent(value, total) }));
}

/** Sum of the estimates, null when no usage carried one. */
const costOf = (usages: readonly ClaudeCodeModelUsage[]): number | null => {
  const known = usages.filter((u) => u.estimatedCost !== null);
  return known.length === 0 ? null : round(sumBy(known, (u) => u.estimatedCost ?? 0));
};

const modelRow = (model: string, usages: readonly ClaudeCodeModelUsage[]): ModelRow => ({
  model,
  inputTokens: sumBy(usages, (u) => u.inputTokens),
  outputTokens: sumBy(usages, (u) => u.outputTokens),
  cacheReadTokens: sumBy(usages, (u) => u.cacheReadTokens),
  cacheCreationTokens: sumBy(usages, (u) => u.cacheCreationTokens),
  estimatedCost: costOf(usages),
});

const tokensOf = (m: ModelRow): number =>
  m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheCreationTokens;

function byModel(usages: readonly ClaudeCodeModelUsage[]): ModelRow[] {
  return [...groupBy(usages, (u) => u.model)]
    .map(([model, list]) => modelRow(model, list))
    .sort(
      (a, b) =>
        (b.estimatedCost ?? -1) - (a.estimatedCost ?? -1) ||
        tokensOf(b) - tokensOf(a) ||
        a.model.localeCompare(b.model),
    );
}

/** Cache reads as a percent of all input tokens; null when no input was reported. */
function cacheReadShare(models: readonly ModelRow[]): number | null {
  const reads = sumBy(models, (m) => m.cacheReadTokens);
  const input = sumBy(models, (m) => m.inputTokens + m.cacheCreationTokens) + reads;
  return input === 0 ? null : percent(reads, input);
}

const distinctOfKind = (rows: readonly ClaudeCodeActivity[], kind: string): number =>
  distinctActors(rows.filter((r) => r.actorKind === kind));

/**
 * Aggregates the per-actor Claude Code rows into the published view (AN-4). The result holds
 * counts and sums only: no e-mail address or key name is copied.
 */
export function claudeCodeView(
  rows: readonly ClaudeCodeActivity[],
  window: Window,
): DashboardClaudeCode {
  const totals = counts(rows);
  const models = byModel(rows.flatMap((r) => r.models));
  return {
    window,
    currency: CURRENCY,
    users: distinctOfKind(rows, 'user'),
    apiKeys: distinctOfKind(rows, 'api'),
    daily: daily(rows),
    totals: { ...totals, acceptRate: acceptRate(totals.accepted, totals.rejected) },
    byTerminal: byTerminal(rows),
    byModel: models,
    estimatedCost: costOf(rows.flatMap((r) => r.models)),
    cacheReadShare: cacheReadShare(models),
  };
}
