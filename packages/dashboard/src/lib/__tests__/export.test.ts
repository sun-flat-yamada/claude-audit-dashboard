import { COMPLIANCE_EXPORT_COLUMNS, type DashboardCheckResult } from '@claude-audit/core/contracts';
import { describe, expect, it } from 'vitest';
import {
  complianceCsv,
  complianceJson,
  escapeCsvCell,
  EXPORT_COLUMNS,
  exportFileName,
  stampFrom,
} from '../export';

const result = (over: Partial<DashboardCheckResult> = {}): DashboardCheckResult => ({
  ruleId: 'CF-001',
  ruleName: 'SSO enforced',
  category: 'configuration',
  severity: 'high',
  status: 'fail',
  message: 'SSO is off',
  remediation: 'Enable SSO',
  evidence: [{ kind: 'setting', label: 'sso=false' }],
  ...over,
});

describe('escapeCsvCell', () => {
  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['line1\nline2', '"line1\nline2"'],
    ['line1\r\nline2', '"line1\r\nline2"'],
    ['say "hi"', '"say ""hi"""'],
    ['', ''],
  ])('quotes per RFC 4180: %j', (input, expected) => {
    expect(escapeCsvCell(input)).toBe(expected);
  });

  it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\tx', '\rx'])('neutralises the prefix of %j', (v) => {
    const out = escapeCsvCell(v);
    expect(out.replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('guards first, then quotes (comma after an injection prefix)', () => {
    expect(escapeCsvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
  });

  it('does not touch a prefix character that is not leading', () => {
    expect(escapeCsvCell('a=b')).toBe('a=b');
  });

  it('maps null to an empty cell', () => {
    expect(escapeCsvCell(null)).toBe('');
  });
});

describe('complianceCsv', () => {
  it('starts with the shared report columns in order, then the extras', () => {
    expect(EXPORT_COLUMNS.slice(0, COMPLIANCE_EXPORT_COLUMNS.length)).toEqual([
      ...COMPLIANCE_EXPORT_COLUMNS,
    ]);
    const header = complianceCsv([]).split('\r\n')[0];
    expect(header).toBe('Rule,Name,Severity,Status,Message,Category,Remediation,Evidence');
  });

  it('writes CRLF rows with a trailing CRLF and keeps the input order', () => {
    const csv = complianceCsv([result(), result({ ruleId: 'AC-001', remediation: null })]);
    expect(csv).toBe(
      'Rule,Name,Severity,Status,Message,Category,Remediation,Evidence\r\n' +
        'CF-001,SSO enforced,high,fail,SSO is off,configuration,Enable SSO,sso=false\r\n' +
        'AC-001,SSO enforced,high,fail,SSO is off,configuration,,sso=false\r\n',
    );
  });

  it('escapes message, remediation and evidence cells', () => {
    const csv = complianceCsv([
      result({
        message: '=bad, "quoted"\nnext',
        remediation: '@x',
        evidence: [
          { kind: 'a', label: 'one' },
          { kind: 'b', label: '+two' },
        ],
      }),
    ]);
    expect(csv).toContain('"\'=bad, ""quoted""\nnext"');
    expect(csv).toContain(",'@x,");
    expect(csv.trimEnd().endsWith('one; +two')).toBe(true);
  });

  it('is byte-stable for the same input', () => {
    expect(complianceCsv([result()])).toBe(complianceCsv([result()]));
  });

  it('exports only the header for empty results', () => {
    expect(complianceCsv([])).toBe(
      'Rule,Name,Severity,Status,Message,Category,Remediation,Evidence\r\n',
    );
  });
});

describe('complianceJson', () => {
  it('uses a fixed key order and names the filter', () => {
    const parsed = JSON.parse(complianceJson([result()], 'fail')) as {
      filter: string;
      count: number;
      results: Array<Record<string, unknown>>;
    };
    expect(parsed.filter).toBe('fail');
    expect(parsed.count).toBe(1);
    expect(Object.keys(parsed.results[0] ?? {})).toEqual([
      'ruleId',
      'ruleName',
      'severity',
      'status',
      'message',
      'category',
      'remediation',
      'evidence',
    ]);
  });

  it('keeps unescaped values (JSON is not a spreadsheet format) and is stable', () => {
    const json = complianceJson([result({ message: '=1+1' })], 'all');
    expect(json).toContain('"message": "=1+1"');
    expect(json).toBe(complianceJson([result({ message: '=1+1' })], 'all'));
    expect(json.endsWith('\n')).toBe(true);
  });

  it('exports an empty list', () => {
    expect(JSON.parse(complianceJson([], 'pass'))).toEqual({
      filter: 'pass',
      count: 0,
      results: [],
    });
  });
});

describe('file names', () => {
  it('derives the stamp from the ISO date without time zone shifts', () => {
    expect(stampFrom('2026-10-04T23:59:59-08:00')).toBe('20261004');
    expect(stampFrom(null, '2026-01-02T00:00:00Z')).toBe('20260102');
    expect(stampFrom(null, null)).toBe('undated');
    expect(stampFrom('garbage')).toBe('undated');
  });

  it('names the filter unless it is all', () => {
    expect(exportFileName('20261004', 'csv')).toBe('compliance-results-20261004.csv');
    expect(exportFileName('20261004', 'json', 'all')).toBe('compliance-results-20261004.json');
    expect(exportFileName('20261004', 'csv', 'fail')).toBe('compliance-results-20261004-fail.csv');
  });
});
