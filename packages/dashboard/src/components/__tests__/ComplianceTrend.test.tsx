import { dashboardViewSchema, type DashboardView } from '@claude-audit/core/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ComplianceSection } from '../sections';

// The committed synthetic sample (never live data): since F-015 it carries three time points.
const SAMPLE = Object.values(
  import.meta.glob<string>('../../../../../data/sample/dashboard.json', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
)[0];

const sample = (): DashboardView => dashboardViewSchema.parse(JSON.parse(SAMPLE ?? '{}'));

const withHistory = (compliance: DashboardView['compliance'], count: number) => ({
  ...compliance,
  history: compliance.history.slice(0, count),
});

describe('score trend of the sample (three time points, F-015)', () => {
  it('the sample carries three increasing time points', () => {
    const { history } = sample().compliance;
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.date)).toEqual([...history.map((h) => h.date)].sort());
    expect(history.at(-1)?.score).toBe(sample().compliance.score);
  });

  it('draws the trend chart with its table view holding one row per point', () => {
    const { compliance } = sample();
    render(<ComplianceSection compliance={compliance} />);
    const figure = document.querySelector('figure');
    expect(figure).not.toBeNull();
    const table = within(figure as HTMLElement).getByRole('table', { hidden: true });
    const rows = within(table).getAllByRole('row', { hidden: true });
    // Header row plus one row per time point.
    expect(rows).toHaveLength(1 + compliance.history.length);
    expect(within(figure as HTMLElement).getByText('View as table')).toBeInTheDocument();
  });

  it('still needs two points: one point shows no trend chart', () => {
    render(<ComplianceSection compliance={withHistory(sample().compliance, 1)} />);
    expect(document.querySelector('figure')).toBeNull();
    expect(screen.getByText('Compliance checks')).toBeInTheDocument();
  });
});
