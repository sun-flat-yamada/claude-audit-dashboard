/**
 * Format-neutral report document. Report definitions produce it; renderers turn it into
 * Markdown, HTML, CSV or JSON. New reports work with every renderer and vice versa.
 */
export type Cell = string | number | null;

export type Section =
  | { type: 'kpis'; title: string; items: { label: string; value: string }[] }
  | { type: 'table'; title: string; columns: string[]; rows: Cell[][] }
  | { type: 'list'; title: string; items: string[] }
  | { type: 'text'; title: string; body: string };

export interface ReportDocument {
  /** File-name friendly id, e.g. `weekly-2026-W40`. */
  id: string;
  kind: string;
  title: string;
  generatedAt: string;
  period: { from: string; to: string } | null;
  sections: Section[];
}

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const formatInteger = (value: number): string => integer.format(value);

export const formatMoney = (value: number, currency = 'USD'): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);

export const formatPercent = (value: number): string => `${value.toFixed(1)}%`;
