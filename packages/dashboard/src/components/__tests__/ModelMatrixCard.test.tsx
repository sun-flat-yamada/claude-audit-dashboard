import type { DashboardView } from '@claude-audit/core/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModelMatrixCard } from '../ModelMatrixCard';

type Matrix = DashboardView['modelMatrix'];

const ok = (over: Record<string, unknown> = {}) =>
  ({
    status: 'ok',
    asOf: null,
    window: { from: '2026-07-01T00:00:00.000Z', to: '2026-09-29T00:00:00.000Z' },
    currency: 'USD',
    months: ['2026-07', '2026-08'],
    models: [
      { key: 'opus', name: 'opus', total: 1500 },
      { key: 'haiku', name: 'haiku', total: 100 },
    ],
    groups: [{ key: 'g1', name: 'Engineering' }],
    omittedModels: 0,
    omittedGroups: 0,
    cells: [{ month: '2026-08', model: 'opus', group: 'g1', cost: 700 }],
    mix: [
      { month: '2026-07', model: 'opus', cost: 700 },
      { month: '2026-08', model: 'opus', cost: 800 },
      { month: '2026-08', model: 'haiku', cost: 100 },
    ],
    monthTotals: [
      { month: '2026-07', cost: 700 },
      { month: '2026-08', cost: 900 },
    ],
    ...over,
  }) as Matrix;

describe('ModelMatrixCard', () => {
  it('renders nothing while the optional collection is off', () => {
    const { container } = render(<ModelMatrixCard matrix={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the latest month model mix with a table twin and a link to the heatmap', () => {
    render(<ModelMatrixCard matrix={ok()} />);
    expect(screen.getByRole('heading', { name: 'Model spend' })).toBeInTheDocument();
    expect(screen.getByText(/August 2026/)).toBeInTheDocument();
    expect(screen.getByText('$800.00 · 88.9%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the model and group heatmap' })).toHaveAttribute(
      'href',
      '#/models',
    );
    const table = screen.getByRole('table');
    expect(within(table).getByRole('row', { name: /haiku/ })).toHaveTextContent('11.1%');
  });

  it('explains an unavailable collection and an empty one', () => {
    const a = render(<ModelMatrixCard matrix={{ status: 'unavailable', reason: 'no key' }} />);
    expect(
      screen.getByText('Model and group spend was not collected (no key).'),
    ).toBeInTheDocument();
    a.unmount();
    render(
      <ModelMatrixCard
        matrix={ok({ cells: [], mix: [], monthTotals: [], months: [], models: [] })}
      />,
    );
    expect(
      screen.getByText('No model spend was reported in the collected period.'),
    ).toBeInTheDocument();
  });
});
