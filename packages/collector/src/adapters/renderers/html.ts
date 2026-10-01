import type { Cell, DocumentRenderer, ReportDocument, Section } from '@claude-audit/core';
import { MAX_TABLE_ROWS } from './markdown.js';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (value: Cell): string =>
  value === null ? '' : String(value).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

const TABLE = 'border-collapse:collapse;margin:8px 0';
const CELL = 'border:1px solid #d4d4d8;padding:4px 8px;text-align:left';

const table = (columns: readonly string[], rows: readonly (readonly Cell[])[]): string =>
  `<table style="${TABLE}"><thead><tr>${columns.map((c) => `<th style="${CELL}">${escapeHtml(c)}</th>`).join('')}</tr></thead>` +
  `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td style="${CELL}">${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

type Render<T extends Section['type']> = (section: Extract<Section, { type: T }>) => string;

const SECTIONS: { [T in Section['type']]: Render<T> } = {
  kpis: (s) =>
    table(
      ['Metric', 'Value'],
      s.items.map((i) => [i.label, i.value]),
    ),
  table: (s) =>
    s.rows.length === 0
      ? '<p><em>No data.</em></p>'
      : table(s.columns, s.rows.slice(0, MAX_TABLE_ROWS)) +
        (s.rows.length > MAX_TABLE_ROWS
          ? `<p><em>${s.rows.length - MAX_TABLE_ROWS} more row(s) in the CSV / JSON export.</em></p>`
          : ''),
  list: (s) => `<ul>${s.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`,
  text: (s) => `<p>${escapeHtml(s.body)}</p>`,
};

export function toHtml(document: ReportDocument): string {
  const sections = document.sections
    .map(
      (s) => `<h2>${escapeHtml(s.title)}</h2>${(SECTIONS[s.type] as Render<Section['type']>)(s)}`,
    )
    .join('');
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(document.title)}</title></head>` +
    `<body style="font-family:system-ui,sans-serif;color:#18181b"><h1>${escapeHtml(document.title)}</h1>` +
    `<p>Generated ${escapeHtml(document.generatedAt)}</p>${sections}</body></html>\n`
  );
}

export const htmlRenderer: DocumentRenderer = {
  id: 'html',
  render: (document) => [{ suffix: '.html', mediaType: 'text/html', content: toHtml(document) }],
};
