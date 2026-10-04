import type { DashboardCheckResult } from '@claude-audit/core/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComplianceResults } from '../ComplianceResults';

const make = (ruleId: string, status: string, message = 'm'): DashboardCheckResult => ({
  ruleId,
  ruleName: `Rule ${ruleId}`,
  category: 'configuration',
  severity: 'high',
  status,
  message,
  remediation: null,
  evidence: [],
});
const RESULTS = [
  make('CF-001', 'fail', '=cmd, "x"'),
  make('CF-002', 'pass'),
  make('CF-003', 'fail'),
];

let blobs: Blob[] = [];
let names: string[] = [];

beforeEach(() => {
  blobs = [];
  names = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:test';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
});
afterEach(() => vi.restoreAllMocks());

const text = (blob: Blob | undefined) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob ?? new Blob());
  });

describe('ComplianceResults export', () => {
  it('offers named export buttons in a labelled group', () => {
    render(<ComplianceResults results={RESULTS} stamp="20261004" />);
    expect(screen.getByRole('group', { name: 'Export compliance results' })).toBeInTheDocument();
    for (const name of [
      'Export CSV (All)',
      'Export JSON (All)',
      'Export all CSV',
      'Export all JSON',
    ]) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
  });

  it('exports the filtered rows, named after the filter, with injection-safe cells', async () => {
    const user = userEvent.setup();
    render(<ComplianceResults results={RESULTS} stamp="20261004" />);
    await user.click(screen.getByRole('button', { name: /^Fail/ }));
    await user.click(screen.getByRole('button', { name: 'Export CSV (Fail)' }));
    expect(names).toEqual(['compliance-results-20261004-fail.csv']);
    const csv = await text(blobs[0]);
    expect(csv).toContain('CF-001');
    expect(csv).toContain('CF-003');
    expect(csv).not.toContain('CF-002');
    expect(csv).toContain('"\'=cmd, ""x"""');
    expect(blobs[0]?.type).toContain('text/csv');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('exports all rows with the all buttons whatever the filter is', async () => {
    const user = userEvent.setup();
    render(<ComplianceResults results={RESULTS} stamp="20261004" />);
    await user.click(screen.getByRole('button', { name: /^Pass/ }));
    await user.click(screen.getByRole('button', { name: 'Export all JSON' }));
    expect(names).toEqual(['compliance-results-20261004.json']);
    const parsed = JSON.parse(await text(blobs[0])) as { count: number; filter: string };
    expect(parsed).toMatchObject({ count: 3, filter: 'all' });
  });

  it('exports the filtered JSON and disables the filtered buttons when nothing matches', async () => {
    const user = userEvent.setup();
    render(<ComplianceResults results={RESULTS} stamp="20261004" />);
    await user.click(screen.getByRole('button', { name: /^Pass/ }));
    await user.click(screen.getByRole('button', { name: 'Export JSON (Pass)' }));
    expect(JSON.parse(await text(blobs[0]))).toMatchObject({ filter: 'pass', count: 1 });
    await user.click(screen.getByRole('button', { name: /^Error/ }));
    expect(screen.getByRole('button', { name: 'Export CSV (Error)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export all CSV' })).toBeEnabled();
  });

  it('disables every export when there are no results', () => {
    render(<ComplianceResults results={[]} />);
    for (const b of screen.getAllByRole('button', { name: /Export/ })) expect(b).toBeDisabled();
  });
});
