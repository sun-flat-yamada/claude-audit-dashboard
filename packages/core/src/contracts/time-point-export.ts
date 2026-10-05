import { csvText } from './compliance-export.js';
import type { KpiDelta, TimePointDiff } from './time-point-diff.js';

/**
 * Export formatters of a time-point diff (F-015): Markdown, CSV and JSON. Pure and
 * deterministic: the same diff always gives the same bytes (fixed column and key order, no
 * clock, no locale). The CSV goes through the shared escaping helper of the compliance export
 * (RFC 4180 and the spreadsheet formula-injection guard).
 */
export type TimePointExportFormat = 'md' | 'csv' | 'json';

export const TIME_POINT_EXPORT_VERSION = 1 as const;

/** CSV columns, in order. One row per score figure, changed rule, changed dataset and KPI. */
export const TIME_POINT_CSV_COLUMNS = [
  'Section',
  'Id',
  'Name',
  'Severity',
  'Base',
  'Target',
  'Change',
  'Delta',
] as const;

export const TIME_POINT_MEDIA_TYPE: Record<TimePointExportFormat, string> = {
  md: 'text/markdown;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

const text = (value: string | number | null): string => (value === null ? '' : String(value));

/** `2026-09-01T12-00-00Z` -> `20260901T120000Z` (string edit only, no time zone dependence). */
const stamp = (id: string): string => id.replaceAll('-', '');

/** `time-point-diff-<base stamp>-<target stamp>.<ext>`. */
export const timePointDiffFileName = (diff: TimePointDiff, format: TimePointExportFormat): string =>
  `time-point-diff-${stamp(diff.base.id)}-${stamp(diff.target.id)}.${format}`;

const direction = (value: number | null): string => {
  if (value === null) return 'n/a';
  if (value === 0) return 'unchanged';
  return value > 0 ? 'increased' : 'decreased';
};

const kpiChange = (k: KpiDelta): string =>
  k.delta === null && k.base !== k.target ? 'changed' : direction(k.delta);

function csvRows(diff: TimePointDiff): (string | number | null)[][] {
  const { score } = diff;
  const rows: (string | number | null)[][] = [
    [
      'score',
      'score',
      'Compliance score',
      '',
      score.base,
      score.target,
      direction(score.delta),
      score.delta,
    ],
    [
      'score',
      'assessed',
      'Assessed rules',
      '',
      score.baseAssessed,
      score.targetAssessed,
      direction(score.assessedDelta),
      score.assessedDelta,
    ],
  ];
  for (const r of diff.rules.changes)
    rows.push(['rule', r.id, r.name, r.severity, r.from, r.to, r.change, null]);
  for (const d of diff.coverage.changes)
    rows.push(['dataset', d.dataset, d.dataset, '', d.from, d.to, d.change, d.countDelta]);
  for (const k of diff.kpis)
    rows.push(['kpi', k.id, k.label, '', k.base, k.target, kpiChange(k), k.delta]);
  return rows;
}

/** CRLF line ends and a trailing CRLF. */
export const timePointDiffCsv = (diff: TimePointDiff): string =>
  csvText([TIME_POINT_CSV_COLUMNS, ...csvRows(diff)]);

/** Fixed key order so the file is byte-stable. */
export function timePointDiffJson(diff: TimePointDiff): string {
  const counts = (c: TimePointDiff['rules']['counts']) => ({
    regressed: c.regressed,
    improved: c.improved,
    unchanged: c.unchanged,
    added: c.added,
    removed: c.removed,
    assessed: c.assessed,
    unassessed: c.unassessed,
  });
  return (
    JSON.stringify(
      {
        schemaVersion: TIME_POINT_EXPORT_VERSION,
        base: diff.base,
        target: diff.target,
        hasChanges: diff.hasChanges,
        score: { ...diff.score },
        rules: {
          counts: counts(diff.rules.counts),
          changes: diff.rules.changes.map((r) => ({
            id: r.id,
            name: r.name,
            category: r.category,
            severity: r.severity,
            from: r.from,
            to: r.to,
            change: r.change,
          })),
        },
        coverage: {
          counts: counts(diff.coverage.counts),
          changes: diff.coverage.changes.map((d) => ({
            dataset: d.dataset,
            from: d.from,
            to: d.to,
            fromCount: d.fromCount,
            toCount: d.toCount,
            countDelta: d.countDelta,
            change: d.change,
          })),
        },
        kpis: diff.kpis.map((k) => ({
          id: k.id,
          label: k.label,
          unit: k.unit,
          base: k.base,
          target: k.target,
          delta: k.delta,
        })),
      },
      null,
      2,
    ) + '\n'
  );
}

/** A Markdown table cell: pipes and line breaks cannot break the table. */
const cell = (value: string | number | null): string =>
  text(value).replaceAll('|', '\\|').replace(/\r?\n/g, ' ');

const table = (header: readonly string[], rows: readonly (readonly string[])[]): string[] => [
  `| ${header.join(' | ')} |`,
  `| ${header.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
];

const signed = (value: number | null): string =>
  value === null ? '' : value > 0 ? `+${String(value)}` : String(value);

/** A readable summary: header, score, rule / dataset changes (when any) and the KPI table. */
export function timePointDiffMarkdown(diff: TimePointDiff): string {
  const { score, rules, coverage } = diff;
  const lines: string[] = [
    '# Time-point comparison',
    '',
    `- Base: ${diff.base.id} (collected ${diff.base.collectedAt})`,
    `- Target: ${diff.target.id} (collected ${diff.target.collectedAt})`,
    `- Changes: ${diff.hasChanges ? 'yes' : 'none'}`,
    '',
    '## Score',
    '',
    ...table(
      ['Figure', 'Base', 'Target', 'Delta'],
      [
        ['Compliance score', text(score.base), text(score.target), signed(score.delta)],
        [
          'Assessed rules',
          `${String(score.baseAssessed)} of ${String(score.baseTotal)}`,
          `${String(score.targetAssessed)} of ${String(score.targetTotal)}`,
          signed(score.assessedDelta),
        ],
      ],
    ),
    '',
    `## Rule changes (${String(rules.changes.length)})`,
    '',
    ...(rules.changes.length === 0
      ? ['No rule changed.']
      : table(
          ['Rule', 'Name', 'Severity', 'Base', 'Target', 'Change'],
          rules.changes.map((r) => [
            r.id,
            r.name,
            r.severity,
            r.from ?? '(none)',
            r.to ?? '(none)',
            r.change,
          ]),
        )),
    '',
    `## Dataset coverage changes (${String(coverage.changes.length)})`,
    '',
    ...(coverage.changes.length === 0
      ? ['No dataset changed.']
      : table(
          ['Dataset', 'Base', 'Target', 'Change'],
          coverage.changes.map((d) => [d.dataset, d.from ?? '(none)', d.to ?? '(none)', d.change]),
        )),
    '',
    '## KPIs',
    '',
    ...table(
      ['KPI', 'Base', 'Target', 'Delta'],
      diff.kpis.map((k) => [k.label, text(k.base), text(k.target), signed(k.delta)]),
    ),
    '',
  ];
  return lines.join('\n');
}

/** The diff in the requested format. */
export function timePointDiffExport(diff: TimePointDiff, format: TimePointExportFormat): string {
  if (format === 'csv') return timePointDiffCsv(diff);
  if (format === 'json') return timePointDiffJson(diff);
  return timePointDiffMarkdown(diff);
}
