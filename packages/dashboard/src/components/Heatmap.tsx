import { useRef, useState, type KeyboardEvent } from 'react';
import { formatMoney, formatPercent } from '../lib/format';
import { legendTicks, type HeatCell, type HeatGrid } from '../lib/usage-matrix-view';

const SCALE_BACKGROUND = (ratio: number): string =>
  `color-mix(in srgb, var(--seq-hi) ${String(Math.round(ratio * 100))}%, var(--seq-lo))`;

/** Plain-language value of one cell, used for the tooltip, the accessible name and the readout. */
export function describeCell(
  cell: HeatCell,
  grid: HeatGrid,
  currency: string,
): { model: string; group: string; text: string } {
  const model = grid.models.find((m) => m.key === cell.model)?.name ?? cell.model;
  const group = grid.groups.find((g) => g.key === cell.group)?.name ?? cell.group;
  const text =
    cell.cost === null
      ? 'no spend reported'
      : `${formatMoney(cell.cost, currency)}, ${formatPercent(cell.shareOfModel)} of the model's ungrouped spend`;
  return { model, group, text };
}

/** Linear, zero-anchored color scale with its low, middle and high values. */
export function HeatLegend({ max, currency }: { max: number; currency: string }) {
  const [low, mid, high] = legendTicks(max);
  return (
    <div className="text-sm">
      <p className="mb-1 text-[var(--text-secondary)]">Spend per cell (linear scale)</p>
      <div
        role="img"
        aria-label={`Color scale from ${formatMoney(low, currency)} (lightest in light mode) to ${formatMoney(high, currency)}`}
        className="h-3 w-full max-w-xs rounded border border-[var(--grid)]"
        style={{ background: 'linear-gradient(to right, var(--seq-lo), var(--seq-hi))' }}
      />
      <div className="tabular mt-1 flex w-full max-w-xs justify-between text-[var(--text-secondary)]">
        <span>{formatMoney(low, currency)}</span>
        <span>{formatMoney(mid, currency)}</span>
        <span>{formatMoney(high, currency)}</span>
      </div>
    </div>
  );
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

interface CellProps {
  grid: HeatGrid;
  currency: string;
  row: number;
  column: number;
  tabStop: boolean;
  onShow: (row: number, column: number) => void;
  onMove: (event: KeyboardEvent, row: number, column: number) => void;
}

/** One focusable cell: value on a surface chip over the scale color, with tooltip and name. */
function HeatCellButton({ grid, currency, row, column, tabStop, onShow, onMove }: CellProps) {
  const cell = grid.cells[row]?.[column];
  if (!cell) return null;
  const d = describeCell(cell, grid, currency);
  return (
    <td role="gridcell" className="p-0">
      <button
        type="button"
        data-cell={`${String(row)}-${String(column)}`}
        tabIndex={tabStop ? 0 : -1}
        title={`${d.model} and ${d.group}: ${d.text}`}
        aria-label={`${d.model}, ${d.group}: ${d.text}`}
        onFocus={() => onShow(row, column)}
        onMouseEnter={() => onShow(row, column)}
        onKeyDown={(event) => onMove(event, row, column)}
        className="flex h-10 w-full min-w-20 items-center justify-center rounded border border-[var(--grid)] focus-visible:outline-2 focus-visible:outline-offset-1"
        style={{ background: cell.cost === null ? 'transparent' : SCALE_BACKGROUND(cell.ratio) }}
      >
        <span className="tabular rounded bg-[var(--surface-1)] px-1.5 py-0.5 text-xs text-[var(--text-primary)]">
          {cell.cost === null ? '–' : formatMoney(cell.cost, currency, true)}
        </span>
      </button>
    </td>
  );
}

/** Roving tab stop, arrow-key movement and the readout text for the heatmap grid. */
function useHeatNavigation(grid: HeatGrid, currency: string) {
  const table = useRef<HTMLTableElement>(null);
  const [active, setActive] = useState<[number, number]>([0, 0]);
  const [readout, setReadout] = useState<string | null>(null);
  const show = (row: number, column: number): void => {
    setActive([row, column]);
    const cell = grid.cells[row]?.[column];
    if (!cell) return;
    const d = describeCell(cell, grid, currency);
    setReadout(`${d.model} and ${d.group}: ${d.text}`);
  };
  const move = (event: KeyboardEvent, row: number, column: number): void => {
    const step = ARROWS[event.key];
    if (!step) return;
    event.preventDefault();
    const r = Math.min(grid.models.length - 1, Math.max(0, row + step[0]));
    const c = Math.min(grid.groups.length - 1, Math.max(0, column + step[1]));
    table.current?.querySelector<HTMLElement>(`[data-cell="${String(r)}-${String(c)}"]`)?.focus();
  };
  return { table, active, readout, show, move };
}

/**
 * Model (rows) x RBAC group (columns) spend. Every cell prints its value on a surface-colored
 * chip, so the text never depends on the fill; the fill is a single-hue continuous scale.
 * One tab stop, arrow keys move between cells; hover and focus fill the readout below. The
 * grid scrolls inside its own container, never the page. Group cells overlap, so there are no
 * row or column totals.
 */
export function Heatmap({ grid, currency }: { grid: HeatGrid; currency: string }) {
  const { table, active, readout, show, move } = useHeatNavigation(grid, currency);
  return (
    <div className="space-y-3">
      <div className="max-w-full overflow-x-auto">
        <table
          ref={table}
          role="grid"
          aria-label="Model by group spend heatmap"
          className="border-separate border-spacing-0.5 text-sm"
        >
          <thead>
            <tr>
              <td />
              {grid.groups.map((g) => (
                <th
                  key={g.key}
                  scope="col"
                  className="min-w-20 px-2 pb-1 text-left align-bottom font-medium [overflow-wrap:anywhere]"
                >
                  {g.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.models.map((m, row) => (
              <tr key={m.key}>
                <th scope="row" className="pr-2 text-left font-medium whitespace-nowrap">
                  {m.name}
                </th>
                {grid.groups.map((g, column) => (
                  <HeatCellButton
                    key={g.key}
                    grid={grid}
                    currency={currency}
                    row={row}
                    column={column}
                    tabStop={active[0] === row && active[1] === column}
                    onShow={show}
                    onMove={move}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p role="status" className="min-h-5 text-sm text-[var(--text-secondary)]">
        {readout ?? 'Hover or focus a cell to see its exact value.'}
      </p>
      <HeatLegend max={grid.max} currency={currency} />
    </div>
  );
}
