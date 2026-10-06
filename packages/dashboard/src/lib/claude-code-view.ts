import type { DashboardClaudeCode, DashboardView } from '@claude-audit/core/contracts';
import type { BarItem } from '../components/ShareBars';
import { formatInteger, formatMoney, formatPercent } from './format';

type ClaudeCode = DashboardClaudeCode;
type Coverage = DashboardView['coverage'][number];

/** The optional dataset behind the page (`sources.claudeCode.enabled`). */
export const CLAUDE_CODE_DATASET = 'claudeCodeActivity';

export const rateText = (value: number | null): string =>
  value === null ? '—' : formatPercent(value);

export const costText = (value: number | null, currency: string): string =>
  value === null ? '—' : formatMoney(value, currency);

/** `2026-09-22 – 2026-09-29`; null without a window. */
export const rangeText = (window: ClaudeCode['window']): string | null =>
  window ? `${window.from.slice(0, 10)} – ${window.to.slice(0, 10)}` : null;

export interface Stat {
  label: string;
  value: string;
}

/** Headline figures of the window, in display order. */
export const headlineStats = (cc: ClaudeCode): Stat[] => [
  { label: 'Active users', value: formatInteger(cc.users) },
  { label: 'API keys', value: formatInteger(cc.apiKeys) },
  { label: 'Sessions', value: formatInteger(cc.totals.sessions) },
  { label: 'Lines added', value: formatInteger(cc.totals.addedLines) },
  { label: 'Lines removed', value: formatInteger(cc.totals.removedLines) },
  { label: 'Commits', value: formatInteger(cc.totals.commits) },
  { label: 'Pull requests', value: formatInteger(cc.totals.pullRequests) },
  { label: 'Suggestion accept rate', value: rateText(cc.totals.acceptRate) },
  { label: 'Estimated cost', value: costText(cc.estimatedCost, cc.currency) },
];

/** Daily accept rate (accepted of accepted + rejected); days without decisions are left out. */
export const dailyAcceptRate = (cc: ClaudeCode): { date: string; acceptRate: number }[] =>
  cc.daily
    .filter((d) => d.accepted + d.rejected > 0)
    .map((d) => ({
      date: d.date,
      acceptRate: Math.round((d.accepted / (d.accepted + d.rejected)) * 1000) / 10,
    }));

/** Terminal labels for the values the Analytics API reports; others pass through. */
const TERMINAL_LABEL: Readonly<Record<string, string>> = {
  vscode: 'VS Code',
  'iTerm.app': 'iTerm2',
  jetbrains: 'JetBrains',
  cursor: 'Cursor',
  tmux: 'tmux',
  'non-interactive': 'Non-interactive (headless)',
};

export const terminalLabel = (terminal: string): string => TERMINAL_LABEL[terminal] ?? terminal;

export const terminalBars = (cc: ClaudeCode): BarItem[] =>
  cc.byTerminal.map((t) => ({
    key: t.terminal,
    label: terminalLabel(t.terminal),
    value: t.sessions,
    display: `${formatInteger(t.sessions)} · ${formatPercent(t.percent)}`,
  }));

export const terminalRows = (cc: ClaudeCode): string[][] =>
  cc.byTerminal.map((t) => [
    terminalLabel(t.terminal),
    formatInteger(t.sessions),
    formatPercent(t.percent),
  ]);

/** The coverage row of the dataset when it was enabled but not collected (with the reason). */
export const notCollected = (coverage: readonly Coverage[]): Coverage | null =>
  coverage.find((c) => c.dataset === CLAUDE_CODE_DATASET && c.status !== 'ok') ?? null;
