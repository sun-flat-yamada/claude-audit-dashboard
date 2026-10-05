import type { DashboardEngagement } from '@claude-audit/core/contracts';
import { formatInteger, formatPercent } from './format';

type Window = DashboardEngagement['window'];
type Counter = DashboardEngagement['products'][number]['counters'][number];
type ClaudeCode = NonNullable<DashboardEngagement['claudeCode']>;

const DAY_MS = 86_400_000;

/** Whole days covered by the roll-up window, or null when it is unknown. */
export function windowDays(window: Window): number | null {
  if (!window) return null;
  const span = Date.parse(window.to) - Date.parse(window.from);
  return Number.isFinite(span) && span > 0 ? Math.floor(span / DAY_MS) : null;
}

export function engagementTitle(window: Window): string {
  const days = windowDays(window);
  return days === null ? 'Product engagement' : `Product engagement (${String(days)} days)`;
}

/** `2026-07-01 – 2026-09-29`; null without a window. */
export const windowRange = (window: Window): string | null =>
  window ? `${window.from.slice(0, 10)} – ${window.to.slice(0, 10)}` : null;

/** A summed counter, or an em dash when no member reported it. */
export const countText = (value: number | null): string =>
  value === null ? '—' : formatInteger(value);

export const rateText = (value: number | null): string =>
  value === null ? '—' : formatPercent(value);

/** `2,219 conversations · 106 projects created`; counters nobody reported are left out. */
export const highlights = (counters: readonly Counter[]): string =>
  counters
    .filter((c): c is Counter & { value: number } => c.value !== null)
    .map((c) => `${formatInteger(c.value)} ${c.label.toLowerCase()}`)
    .join(' · ');

/** Headline Claude Code figures in display order. */
export const codeFacts = (cc: ClaudeCode): { label: string; value: string }[] => [
  { label: 'Lines added', value: countText(cc.addedLines) },
  { label: 'Lines removed', value: countText(cc.removedLines) },
  { label: 'Commits', value: countText(cc.commits) },
  { label: 'Pull requests', value: countText(cc.pullRequests) },
  { label: 'Sessions', value: countText(cc.sessions) },
  { label: 'Suggestion accept rate', value: rateText(cc.acceptRate) },
];

/** Rows of the per-tool "View as table" twin: tool, accepted, rejected, accept rate. */
export const toolTableRows = (cc: ClaudeCode): string[][] =>
  cc.tools.map((t) => [
    t.label,
    formatInteger(t.accepted),
    formatInteger(t.rejected),
    rateText(t.acceptRate),
  ]);
