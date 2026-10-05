import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Models } from '../Models';

const raw = (files: Record<string, string>): string | undefined => Object.values(files)[0];
// Synthetic sample only (never live data).
const SAMPLE_MATRIX = raw(
  import.meta.glob<string>('../../../../../data/sample/detail/usage-matrix.json', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
);
const SAMPLE_MANIFEST = raw(
  import.meta.glob<string>('../../../../../data/sample/detail/index.json', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
);

const NOW = '2026-09-29T12:00:00.000Z';
const matrixFile = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  generatedAt: NOW,
  asOf: '2026-09-29T08:00:00.000Z',
  window: { from: '2026-07-01T00:00:00.000Z', to: '2026-09-29T00:00:00.000Z' },
  currency: 'USD',
  months: ['2026-07', '2026-08'],
  models: [
    { key: 'claude-opus-5', name: 'claude-opus-5', total: 1500 },
    { key: 'claude-haiku-4-5', name: 'claude-haiku-4-5', total: 100 },
  ],
  groups: [
    { key: 'g1', name: 'Engineering' },
    { key: 'g2', name: 'Finance' },
  ],
  omittedModels: 0,
  omittedGroups: 0,
  cells: [
    { month: '2026-07', model: 'claude-opus-5', group: 'g1', cost: 600 },
    { month: '2026-07', model: 'claude-opus-5', group: 'g2', cost: 400 },
    { month: '2026-08', model: 'claude-opus-5', group: 'g1', cost: 700 },
    { month: '2026-08', model: 'claude-haiku-4-5', group: 'g2', cost: 0 },
  ],
  mix: [
    { month: '2026-07', model: 'claude-opus-5', cost: 700 },
    { month: '2026-08', model: 'claude-opus-5', cost: 800 },
    { month: '2026-08', model: 'claude-haiku-4-5', cost: 100 },
  ],
  monthTotals: [
    { month: '2026-07', cost: 700 },
    { month: '2026-08', cost: 900 },
  ],
  ...over,
});
const manifest = (files: unknown[] = []) => ({
  schemaVersion: 1,
  generatedAt: NOW,
  collectedAt: NOW,
  source: 'demo',
  maskPii: true,
  files,
});
const entry = (over: Record<string, unknown> = {}) => ({
  kind: 'usage-matrix',
  path: 'detail/usage-matrix.json',
  schemaVersion: 1,
  status: 'ok',
  reason: null,
  count: 4,
  month: null,
  ...over,
});

type Reply = unknown | 404 | 500;
function serve(routes: { matrix: Reply; manifest: Reply }): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const reply = String(url).endsWith('/usage-matrix.json') ? routes.matrix : routes.manifest;
    if (typeof reply === 'number') return new Response('{}', { status: reply });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
}
const open = (routes: { matrix: Reply; manifest: Reply }) =>
  render(<Models baseUrl="/" fetchImpl={serve(routes)} />);
const ready = (over: Record<string, unknown> = {}) =>
  open({ matrix: matrixFile(over), manifest: manifest([entry()]) });
const grid = () => screen.findByRole('grid', { name: 'Model by group spend heatmap' });

describe('Models page', () => {
  it('renders the heatmap with values, the legend, the overlap note and the mix trend', async () => {
    ready();
    const heat = await grid();
    expect(screen.getByRole('heading', { level: 1, name: 'Models' })).toBeInTheDocument();
    expect(within(heat).getByRole('columnheader', { name: 'Engineering' })).toBeInTheDocument();
    expect(within(heat).getByRole('rowheader', { name: 'claude-opus-5' })).toBeInTheDocument();
    const cell = within(heat).getByRole('button', {
      name: /^claude-opus-5, Engineering: \$1,300\.00, 86\.7% of the model's ungrouped spend$/,
    });
    expect(within(cell).getByText('$1.3K')).toBeInTheDocument();
    expect(
      within(heat).getByRole('button', {
        name: 'claude-haiku-4-5, Engineering: no spend reported',
      }),
    ).toHaveTextContent('–');
    expect(screen.getByRole('img', { name: /^Color scale from \$0/ })).toBeInTheDocument();
    expect(screen.getByText('Spend per cell (linear scale)')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Group spend overlaps' })).toHaveTextContent(
      'Do not add cells up',
    );
    const bar = screen.getByRole('img', {
      name: /^July 2026, total \$700\.00: claude-opus-5 100\.0%/,
    });
    expect(bar).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Model mix legend' })).toBeInTheDocument();
    // No group totals anywhere: only per-cell values and the ungrouped model totals.
    expect(screen.queryByText(/total \(sum\)/i)).not.toBeInTheDocument();
  });

  it('shows a hover / focus readout with the exact value', async () => {
    const user = userEvent.setup();
    ready();
    const heat = await grid();
    expect(screen.getByRole('status')).toHaveTextContent('Hover or focus a cell');
    await user.hover(within(heat).getByRole('button', { name: /^claude-opus-5, Finance/ }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'claude-opus-5 and Finance: $400.00, 26.7% of the model',
    );
  });

  it('is keyboard accessible: one tab stop and arrow keys move between cells', async () => {
    const user = userEvent.setup();
    ready();
    const heat = await grid();
    const buttons = within(heat).getAllByRole('button');
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    await user.click(buttons[0] as HTMLElement);
    expect(buttons[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(buttons[1]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(buttons[3]).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowUp}{ArrowUp}{ArrowLeft}');
    expect(buttons[0]).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('claude-opus-5 and Engineering');
  });

  it('switches both charts to tables with the same numbers and back', async () => {
    const user = userEvent.setup();
    ready();
    await grid();
    await user.click(screen.getByRole('button', { name: 'View as table' }));
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    const spend = screen.getByRole('table', { name: 'Model by group spend' });
    const row = within(spend).getByRole('row', { name: /claude-opus-5 Engineering/ });
    expect(row).toHaveTextContent('$1,300.00');
    expect(row).toHaveTextContent('86.7%');
    expect(within(spend).queryByRole('row', { name: /claude-haiku-4-5 Engineering/ })).toBeNull();
    const totals = screen.getByRole('table', { name: 'Model totals (ungrouped)' });
    expect(within(totals).getByRole('row', { name: /claude-opus-5/ })).toHaveTextContent(
      '$1,500.00',
    );
    const mix = screen.getByRole('table', { name: 'Model mix by month' });
    expect(
      within(mix).getByRole('row', { name: /August 2026 claude-haiku-4-5/ }),
    ).toHaveTextContent('11.1%');
    await user.click(screen.getByRole('button', { name: 'View as chart' }));
    expect(await grid()).toBeInTheDocument();
  });

  it('filters by period and by search, with a no-match state', async () => {
    const user = userEvent.setup();
    ready();
    await grid();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), '2026-08');
    expect(
      screen.getByRole('button', { name: /^claude-opus-5, Engineering: \$700\.00, 87\.5%/ }),
    ).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search models and groups' }), 'fin');
    expect(screen.queryByRole('columnheader', { name: 'Engineering' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Finance' })).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search models and groups' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search models and groups' }), 'zzz');
    expect(screen.getByText('No models or groups match “zzz”.')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('says how many models and groups were left out', async () => {
    ready({ omittedModels: 2, omittedGroups: 1 });
    await grid();
    expect(screen.getByText(/Not shown: 2 more models and 1 more groups/)).toBeInTheDocument();
  });

  it('shows an empty state when there is no spend', async () => {
    ready({ cells: [], mix: [], monthTotals: [], months: [], models: [], groups: [] });
    expect(
      await screen.findByText('No model spend was reported in the collected period.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('shows loading, then not published with the opt-in hint', async () => {
    open({ matrix: 404, manifest: manifest() });
    expect(screen.getByRole('status')).toHaveTextContent('Loading model and group spend');
    expect(
      await screen.findByText(/Model and group spend data is not published/),
    ).toBeInTheDocument();
    expect(screen.getByText(/sources\.usageMatrix\.enabled/)).toBeInTheDocument();
  });

  it('shows not collected with the reason from the manifest', async () => {
    open({
      matrix: 404,
      manifest: manifest([
        entry({
          status: 'unavailable',
          reason: 'the cost report rejected the request (HTTP 400)',
          count: null,
        }),
      ]),
    });
    expect(
      await screen.findByText(
        'Model and group spend data was not collected (the cost report rejected the request (HTTP 400)).',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sources\.usageMatrix\.enabled/)).not.toBeInTheDocument();
  });

  it('shows an error for a failing or malformed file', async () => {
    open({ matrix: 500, manifest: manifest() });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load model and group spend',
    );
  });

  it('shows an error when the file does not match the contract', async () => {
    open({ matrix: { schemaVersion: 2 }, manifest: manifest() });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('renders the generated sample', async () => {
    open({
      matrix: JSON.parse(SAMPLE_MATRIX ?? '{}'),
      manifest: JSON.parse(SAMPLE_MANIFEST ?? '{}'),
    });
    const heat = await grid();
    expect(within(heat).getByRole('columnheader', { name: 'Engineering' })).toBeInTheDocument();
    expect(within(heat).getByRole('columnheader', { name: 'No group' })).toBeInTheDocument();
    expect(
      within(heat).getByRole('button', { name: /^claude-haiku-4-5, Legal: \$0\.00/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /total \$/ })).toHaveLength(3);
  });
});
