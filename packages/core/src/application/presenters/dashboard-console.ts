import type { DashboardConsole, DashboardShare } from '../../contracts/dashboard-view.js';
import type {
  ConsoleApiKey,
  ConsoleCostRow,
  ConsoleUsageRow,
  ConsoleWorkspace,
} from '../../domain/model/optional-entities.js';
import { countBy, sortedByValue, sumBy, totalsBy } from '../../domain/util/collections.js';
import { percent, round } from '../../domain/util/numbers.js';

/** Key and label of usage and cost rows without a workspace id. */
export const DEFAULT_WORKSPACE = { key: 'default', label: 'Default workspace' } as const;

/** Key of cost rows without a model or cost type. */
export const UNATTRIBUTED = '(unattributed)';

/** Fallback currency when no cost row was collected. */
const CURRENCY = 'USD';

export interface ConsoleInput {
  usage: readonly ConsoleUsageRow[];
  cost: readonly ConsoleCostRow[];
  /** Null when the dataset was not collected. */
  workspaces: readonly ConsoleWorkspace[] | null;
  /** Null when the dataset was not collected. */
  apiKeys: readonly ConsoleApiKey[] | null;
  window: DashboardConsole['window'];
}

type Daily = DashboardConsole['daily'][number];

/** The most frequent currency of the cost rows (ties: alphabetical), USD without rows. */
export function dominantCurrency(rows: readonly ConsoleCostRow[]): string {
  return sortedByValue(countBy(rows, (r) => r.currency))[0]?.[0] ?? CURRENCY;
}

function shares(
  rows: readonly ConsoleCostRow[],
  key: (r: ConsoleCostRow) => string,
  label: (key: string) => string = (k) => k,
): DashboardShare[] {
  const total = sumBy(rows, (r) => r.amount);
  return sortedByValue(totalsBy(rows, key, (r) => r.amount)).map(([k, value]) => ({
    key: k,
    label: label(k),
    value: round(value),
    percent: percent(value, total),
  }));
}

const workspaceKey = (r: { workspaceId: string | null }): string =>
  r.workspaceId ?? DEFAULT_WORKSPACE.key;

function workspaceLabels(workspaces: readonly ConsoleWorkspace[] | null): (key: string) => string {
  const names = new Map((workspaces ?? []).map((w) => [w.id, w.name]));
  return (key) =>
    key === DEFAULT_WORKSPACE.key ? DEFAULT_WORKSPACE.label : (names.get(key) ?? key);
}

const emptyDay = (date: string): Daily => ({
  date,
  cost: 0,
  uncachedInputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
});

function daily(usage: readonly ConsoleUsageRow[], cost: readonly ConsoleCostRow[]): Daily[] {
  const days = new Map<string, Daily>();
  const day = (date: string): Daily => {
    const found = days.get(date);
    if (found) return found;
    const created = emptyDay(date);
    days.set(date, created);
    return created;
  };
  for (const r of cost) day(r.date).cost += r.amount;
  for (const r of usage) {
    const d = day(r.date);
    d.uncachedInputTokens += r.uncachedInputTokens;
    d.cacheReadInputTokens += r.cacheReadInputTokens;
    d.cacheCreationInputTokens += r.cacheCreationInputTokens;
    d.outputTokens += r.outputTokens;
  }
  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, cost: round(d.cost) }));
}

function tokens(usage: readonly ConsoleUsageRow[]): DashboardConsole['tokens'] {
  return {
    uncachedInput: sumBy(usage, (r) => r.uncachedInputTokens),
    cacheRead: sumBy(usage, (r) => r.cacheReadInputTokens),
    cacheWrite: sumBy(usage, (r) => r.cacheCreationInputTokens),
    output: sumBy(usage, (r) => r.outputTokens),
  };
}

/** Cache reads as a percent of all input tokens; null when no input was reported. */
export function cacheReadShare(t: DashboardConsole['tokens']): number | null {
  const input = t.uncachedInput + t.cacheRead + t.cacheWrite;
  return input === 0 ? null : percent(t.cacheRead, input);
}

function workspaceCounts(list: readonly ConsoleWorkspace[] | null): DashboardConsole['workspaces'] {
  if (!list) return null;
  const archived = list.filter((w) => w.archivedAt !== null).length;
  return { active: list.length - archived, archived };
}

/** Keys counted per status; names, ids and creators are never copied. */
function keyCounts(list: readonly ConsoleApiKey[] | null): DashboardConsole['apiKeys'] {
  if (!list) return null;
  return sortedByValue(countBy(list, (k) => k.status)).map(([status, count]) => ({
    status,
    count,
  }));
}

/**
 * Aggregates the Console usage, cost, workspace and API key rows into the published view (AN-5).
 * Cost rows in a currency other than the dominant one are left out so amounts never mix.
 */
export function consoleView(input: ConsoleInput): DashboardConsole {
  const currency = dominantCurrency(input.cost);
  const cost = input.cost.filter((r) => r.currency === currency);
  const totals = tokens(input.usage);
  return {
    window: input.window,
    currency,
    totalCost: round(sumBy(cost, (r) => r.amount)),
    daily: daily(input.usage, cost),
    byModel: shares(cost, (r) => r.model ?? UNATTRIBUTED),
    byWorkspace: shares(cost, workspaceKey, workspaceLabels(input.workspaces)),
    byCostType: shares(cost, (r) => r.costType ?? UNATTRIBUTED),
    tokens: totals,
    cacheReadShare: cacheReadShare(totals),
    webSearchRequests: sumBy(input.usage, (r) => r.webSearchRequests),
    workspaces: workspaceCounts(input.workspaces),
    apiKeys: keyCounts(input.apiKeys),
  };
}
