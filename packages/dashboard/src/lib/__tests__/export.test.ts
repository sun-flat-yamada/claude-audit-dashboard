import { COMPLIANCE_EXPORT_COLUMNS, type DashboardCheckResult } from '@claude-audit/core/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildComplianceCsv,
  buildComplianceJson,
  csvCell,
  EXPORT_COLUMNS,
  exportFileName,
} from '../export';

const result = (over: Partial<DashboardCheckResult> = {}): DashboardCheckResult => ({
  ruleId: 'AC-001',
  ruleName: 'Inactive members',
  category: 'access-control',
  severity: 'high',
  status: 'fail',
  message: 'plain',
  remediation: null,
  evidence: [],
  ...over,
});

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['line1\nline2', '"line1\nline2"'],
    ['cr\rx', '"cr\rx"'],
    ['say "hi"', '"say ""hi"""'],
  ])('escapes %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\tx', '\rx'])('defuses formula prefix %j', (input) => {
    expect(csvCell(input).replace(/^"/, '')).toMatch(/^'/);
  });

  it('quotes a defused cell that also needs quoting', () => {
    expect(csvCell('=a,b')).toBe('"\'=a,b"');
  });
});

describe('buildComplianceCsv', () => {
  it('starts with the shared columns in order, then the extras', () => {
    const header = buildComplianceCsv([]).split('\r\n')[0]?.split(',');
    expect(header?.slice(0, COMPLIANCE_EXPORT_COLUMNS.length)).toEqual([
      ...COMPLIANCE_EXPORT_COLUMNS,
    ]);
    expect(header).toEqual(EXPORT_COLUMNS);
  });

  it('writes only the header for no results, with a trailing CRLF', () => {
    expect(buildComplianceCsv([])).toBe(`${EXPORT_COLUMNS.join(',')}\r\n`);
  });

  it('joins evidence labels and keeps row order', () => {
    const csv = buildComplianceCsv([
      result({
        ruleId: 'B',
        evidence: [
          { kind: 'm', label: 'x@example.com' },
          { kind: 'm', label: 'y' },
        ],
      }),
      result({ ruleId: 'A', remediation: 'do, this' }),
    ]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[1]).toContain('x@example.com; y');
    expect(lines[1]?.startsWith('B,')).toBe(true);
    expect(lines[2]).toContain('"do, this"');
  });

  it('is deterministic', () => {
    expect(buildComplianceCsv([result()])).toBe(buildComplianceCsv([result()]));
  });
});

describe('buildComplianceJson', () => {
  it('emits objects keyed in column order', () => {
    const parsed = JSON.parse(buildComplianceJson([result({ message: '=1' })])) as Record<
      string,
      string
    >[];
    expect(Object.keys(parsed[0] ?? {})).toEqual(EXPORT_COLUMNS);
    expect(parsed[0]?.Message).toBe('=1'); // JSON is not spreadsheet input: no guard prefix
  });

  it('is an empty array for no results', () => {
    expect(JSON.parse(buildComplianceJson([]))).toEqual([]);
  });
});

describe('exportFileName', () => {
  it('uses the collection date and omits the suffix for all', () => {
    expect(exportFileName('2026-09-29T12:00:00.000Z', 'csv')).toBe(
      'compliance-results-20260929.csv',
    );
    expect(exportFileName('2026-09-29T12:00:00.000Z', 'json', 'all')).toBe(
      'compliance-results-20260929.json',
    );
  });

  it('appends the status filter', () => {
    expect(exportFileName('2026-09-29T12:00:00.000Z', 'csv', 'fail')).toBe(
      'compliance-results-20260929-fail.csv',
    );
  });

  it('falls back when nothing was collected', () => {
    expect(exportFileName(null, 'csv')).toBe('compliance-results-unknown.csv');
  });
});
