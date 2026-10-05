import type { DashboardView } from '@claude-audit/core/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CoverageSection } from '../sections';

const entry = (
  dataset: string,
  over: Partial<DashboardView['coverage'][number]> = {},
): DashboardView['coverage'][number] => ({
  dataset,
  status: 'ok',
  source: `GET /v1/example/${dataset}`,
  reason: null,
  count: 3,
  asOf: null,
  ...over,
});

const rowOf = (dataset: string): HTMLElement =>
  within(screen.getByRole('table')).getByRole('row', { name: new RegExp(`^${dataset}`) });

describe('Data coverage with the optional datasets (B4)', () => {
  it('shows the Console and Claude Code datasets with their status, count and reason', () => {
    render(
      <CoverageSection
        coverage={[
          entry('members', { count: 40 }),
          entry('consoleWorkspaces', { count: 3 }),
          entry('consoleApiKeys', {
            status: 'unavailable',
            count: null,
            source: 'GET /v1/organizations/api_keys',
            reason: 'No Console Admin API key (set ANTHROPIC_CONSOLE_ADMIN_API_KEY)',
          }),
          entry('consoleUsage', {
            status: 'error',
            count: null,
            reason: 'Unexpected response from /v1/organizations/usage_report/messages',
          }),
          entry('claudeCodeActivity', { count: 40 }),
        ]}
      />,
    );
    expect(screen.getByText('Data coverage')).toBeInTheDocument();
    expect(within(rowOf('consoleWorkspaces')).getByText('3')).toBeInTheDocument();
    expect(within(rowOf('claudeCodeActivity')).getByText('40')).toBeInTheDocument();
    const missing = rowOf('consoleApiKeys');
    expect(within(missing).getByText(/unavailable/i)).toBeInTheDocument();
    expect(within(missing).getByText(/ANTHROPIC_CONSOLE_ADMIN_API_KEY/)).toBeInTheDocument();
    expect(within(rowOf('consoleUsage')).getByText(/error/i)).toBeInTheDocument();
    expect(within(rowOf('consoleUsage')).getByText(/Unexpected response/)).toBeInTheDocument();
  });

  it('is unchanged without optional datasets: only the listed rows appear', () => {
    render(<CoverageSection coverage={[entry('members'), entry('usage')]} />);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
    expect(screen.queryByText(/console/i)).not.toBeInTheDocument();
  });
});
