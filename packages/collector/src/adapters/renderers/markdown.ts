import type { Cell, DocumentRenderer, ReportDocument, Section } from '@claude-audit/core';

const cell = (value: Cell): string =>
  value === null ? '' : String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

const row = (cells: readonly Cell[]): string => `| ${cells.map(cell).join(' | ')} |`;

/** Long tables (raw records) are cut for readability; CSV and JSON exports keep every row. */
export const MAX_TABLE_ROWS = 50;

const omitted = (total: number): string[] =>
  total > MAX_TABLE_ROWS
    ? ['', `_${total - MAX_TABLE_ROWS} more row(s) in the CSV / JSON export._`]
    : [];

type Render<T extends Section['type']> = (section: Extract<Section, { type: T }>) => string[];

const SECTIONS: { [T in Section['type']]: Render<T> } = {
  kpis: (s) => [
    row(['Metric', 'Value']),
    row(['---', '---']),
    ...s.items.map((i) => row([i.label, i.value])),
  ],
  table: (s) =>
    s.rows.length === 0
      ? ['_No data._']
      : [
          row(s.columns),
          row(s.columns.map(() => '---')),
          ...s.rows.slice(0, MAX_TABLE_ROWS).map(row),
          ...omitted(s.rows.length),
        ],
  list: (s) => s.items.map((item) => `- ${item}`),
  text: (s) => [s.body],
};

const renderSection = (section: Section): string[] => [
  `## ${section.title}`,
  '',
  ...(SECTIONS[section.type] as Render<Section['type']>)(section),
  '',
];

export function toMarkdown(document: ReportDocument): string {
  const period = document.period
    ? `Period: ${document.period.from} – ${document.period.to}  \n`
    : '';
  return [
    `# ${document.title}`,
    '',
    `${period}Generated: ${document.generatedAt}`,
    '',
    ...document.sections.flatMap(renderSection),
  ].join('\n');
}

export const markdownRenderer: DocumentRenderer = {
  id: 'markdown',
  render: (document) => [
    { suffix: '.md', mediaType: 'text/markdown', content: toMarkdown(document) },
  ],
};
