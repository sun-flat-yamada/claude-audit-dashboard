import type { DashboardConsole, DashboardShare, DashboardView } from '@claude-audit/core/contracts';
import type { BarItem } from '../components/ShareBars';
import { formatInteger, formatMoney, formatMoneyHeadline, formatPercent } from './format';

type Console = DashboardConsole;
type Coverage = DashboardView['coverage'][number];

/** The optional datasets behind the page (`sources.console.enabled`). */
export const CONSOLE_DATASETS = [
  'consoleUsage',
  'consoleCost',
  'consoleWorkspaces',
  'consoleApiKeys',
] as const;

export const rateText = (value: number | null): string =>
  value === null ? '—' : formatPercent(value);

/** `2026-09-05 – 2026-10-05`; null without a window. */
export const rangeText = (window: Console['window']): string | null =>
  window ? `${window.from.slice(0, 10)} – ${window.to.slice(0, 10)}` : null;

export interface Stat {
  label: string;
  value: string;
}

/** Keys the API reports as `active`; null when the key list was not collected. */
export const activeKeys = (c: Console): number | null =>
  c.apiKeys ? (c.apiKeys.find((k) => k.status === 'active')?.count ?? 0) : null;

const countText = (value: number | null): string => (value === null ? '—' : formatInteger(value));

/** Headline figures of the window, in display order. */
export const headlineStats = (c: Console): Stat[] => [
  { label: 'Spend', value: formatMoneyHeadline(c.totalCost, c.currency) },
  { label: 'Cache read share', value: rateText(c.cacheReadShare) },
  { label: 'Active workspaces', value: countText(c.workspaces?.active ?? null) },
  { label: 'Active API keys', value: countText(activeKeys(c)) },
  { label: 'Web search requests', value: formatInteger(c.webSearchRequests) },
];

/** Labels of keys the presenter uses for rows without a value, and of the known cost types. */
const COST_TYPE_LABEL: Readonly<Record<string, string>> = {
  tokens: 'Tokens',
  web_search: 'Web search',
  code_execution: 'Code execution',
  '(unattributed)': 'Unattributed',
};

const MODEL_LABEL: Readonly<Record<string, string>> = {
  '(unattributed)': 'Not model-specific',
};

export type Breakdown = 'byModel' | 'byWorkspace' | 'byCostType';

/** Display label of a share: cost types and empty models get readable names. */
export function shareLabel(breakdown: Breakdown, share: DashboardShare): string {
  if (breakdown === 'byCostType') return COST_TYPE_LABEL[share.key] ?? share.label;
  if (breakdown === 'byModel') return MODEL_LABEL[share.key] ?? share.label;
  return share.label;
}

export const shareBars = (c: Console, breakdown: Breakdown): BarItem[] =>
  c[breakdown].map((s) => ({
    key: s.key,
    label: shareLabel(breakdown, s),
    value: s.value,
    display: `${formatMoney(s.value, c.currency)} · ${formatPercent(s.percent)}`,
  }));

export const shareRows = (c: Console, breakdown: Breakdown): string[][] =>
  c[breakdown].map((s) => [
    shareLabel(breakdown, s),
    formatMoney(s.value, c.currency),
    formatPercent(s.percent),
  ]);

export interface TokenRow {
  label: string;
  tokens: number;
  /** Share of all tokens of the window; null when there were none. */
  share: number | null;
}

/** Token totals by type with their share of all tokens (input of every kind plus output). */
export function tokenRows(c: Console): TokenRow[] {
  const { uncachedInput, cacheRead, cacheWrite, output } = c.tokens;
  const total = uncachedInput + cacheRead + cacheWrite + output;
  const row = (label: string, tokens: number): TokenRow => ({
    label,
    tokens,
    share: total === 0 ? null : Math.round((tokens / total) * 1000) / 10,
  });
  return [
    row('Uncached input', uncachedInput),
    row('Cache read', cacheRead),
    row('Cache write', cacheWrite),
    row('Output', output),
  ];
}

/** `2 active · 1 archived`: API keys per status, as the API reports them. */
export const keyStatusText = (c: Console): string | null =>
  c.apiKeys && c.apiKeys.length > 0
    ? c.apiKeys.map((k) => `${formatInteger(k.count)} ${k.status}`).join(' · ')
    : null;

/** Console datasets that were enabled but not collected (with their reasons). */
export const notCollected = (coverage: readonly Coverage[]): Coverage[] =>
  coverage.filter(
    (c) => (CONSOLE_DATASETS as readonly string[]).includes(c.dataset) && c.status !== 'ok',
  );

/** `Not collected: consoleUsage, consoleCost (reason).`: datasets grouped by their reason. */
export function missingText(missing: readonly Coverage[]): string {
  const byReason = new Map<string, string[]>();
  for (const m of missing) {
    const reason = m.reason ?? m.status;
    byReason.set(reason, [...(byReason.get(reason) ?? []), m.dataset]);
  }
  const parts = [...byReason].map(([reason, names]) => `${names.join(', ')} (${reason})`);
  return `Not collected: ${parts.join('; ')}.`;
}
