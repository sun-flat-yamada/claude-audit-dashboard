import type { Cell, DocumentRenderer, Section } from '@claude-audit/core';

const quote = (value: Cell): string => {
  const text = value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** One RFC 4180 file per table section (e.g. raw cost records for billing integration). */
export const csvRenderer: DocumentRenderer = {
  id: 'csv',
  render: (document) =>
    document.sections
      .filter((s): s is Extract<Section, { type: 'table' }> => s.type === 'table')
      .map((s) => ({
        suffix: `.${slug(s.title)}.csv`,
        mediaType: 'text/csv',
        content: [s.columns, ...s.rows].map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n',
      })),
};
