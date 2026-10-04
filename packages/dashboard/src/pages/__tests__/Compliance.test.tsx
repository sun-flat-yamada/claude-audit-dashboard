import type { DashboardView } from '@claude-audit/core/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Compliance } from '../Compliance';

const base = {
  category: 'c',
  severity: 'high',
  message: 'm',
  remediation: null,
  evidence: [],
};
const view = {
  collectedAt: '2026-09-29T12:00:00.000Z',
  compliance: {
    results: [
      { ...base, ruleId: 'AC-001', ruleName: 'One', status: 'fail' },
      { ...base, ruleId: 'AC-002', ruleName: 'Two', status: 'pass' },
      { ...base, ruleId: 'AC-003', ruleName: '=Three', status: 'pass' },
    ],
  },
} as unknown as DashboardView;

let blobs: Blob[];
let names: string[];

beforeEach(() => {
  blobs = [];
  names = [];
  URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
    blobs.push(b as Blob);
    return 'blob:x';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
});
afterEach(() => vi.restoreAllMocks());

const text = (b: Blob | undefined) => b?.text() ?? Promise.resolve('');

describe('Compliance export', () => {
  it('offers only the export-all buttons while no filter is active', () => {
    render(<Compliance view={view} />);
    const group = screen.getByRole('group', { name: 'Export' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Export all CSV', 'Export all JSON']);
  });

  it('downloads the filtered view, named after the filter', async () => {
    const user = userEvent.setup();
    render(<Compliance view={view} />);
    await user.click(screen.getByRole('button', { name: /^Pass/ }));
    await user.click(screen.getByRole('button', { name: 'Export CSV (Pass)' }));
    expect(names).toEqual(['compliance-results-20260929-pass.csv']);
    const csv = await text(blobs[0]);
    expect(csv).toContain('AC-002');
    expect(csv).not.toContain('AC-001');
    expect(csv).toContain("'=Three"); // formula guard
  });

  it('downloads everything regardless of the filter', async () => {
    const user = userEvent.setup();
    render(<Compliance view={view} />);
    await user.click(screen.getByRole('button', { name: /^Fail/ }));
    await user.click(screen.getByRole('button', { name: 'Export all JSON' }));
    expect(names).toEqual(['compliance-results-20260929.json']);
    const rows = JSON.parse(await text(blobs[0])) as unknown[];
    expect(rows).toHaveLength(3);
    expect(blobs[0]?.type).toContain('application/json');
  });
});
