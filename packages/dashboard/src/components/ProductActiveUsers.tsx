import type { DashboardAdoption } from '@claude-audit/core/contracts';
import {
  productTrend,
  productTrendRows,
  sparklinePoints,
  trendLabel,
  type ProductRow,
} from '../lib/adoption-view';
import { formatInteger } from '../lib/format';
import { TableView } from './Card';
import { ScrollRegion } from './ScrollRegion';

const SPARK = { width: 96, height: 24 };
const CELL = 'border-b border-[var(--grid)] py-1.5 pr-4';

/** One-hue (slot 1) weekly trend; the y scale is shared by every product row. */
function Sparkline({ label, points }: { label: string; points: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      width={SPARK.width}
      height={SPARK.height + 4}
      viewBox={`0 -2 ${String(SPARK.width)} ${String(SPARK.height + 4)}`}
      className="block overflow-visible"
    >
      <title>{label}</title>
      {points && (
        <polyline
          points={points}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function ProductTableRow({
  row,
  weekly,
  max,
}: {
  row: ProductRow;
  weekly: DashboardAdoption['productWeekly'];
  max: number;
}) {
  const trend = productTrend(weekly, row.product);
  return (
    <tr>
      <th scope="row" className={`${CELL} font-medium whitespace-nowrap`}>
        {row.label}
      </th>
      <td className={`${CELL} text-right`}>{formatInteger(row.dau)}</td>
      <td className={`${CELL} text-right`}>{formatInteger(row.wau)}</td>
      <td className={`${CELL} text-right`}>{formatInteger(row.mau)}</td>
      <td className="border-b border-[var(--grid)] py-1.5">
        <Sparkline
          label={trendLabel(row.label, trend)}
          points={sparklinePoints(trend, { ...SPARK, max })}
        />
      </td>
    </tr>
  );
}

/**
 * Active users per product on the latest day, with a weekly-active sparkline per product. Six
 * products exceed the categorical palette, so a table with one-hue sparklines replaces a
 * multi-line chart; the "View as table" twin holds the exact weekly values.
 */
export function ProductActiveUsers({ adoption }: { adoption: DashboardAdoption }) {
  const products = adoption.byProduct ?? [];
  if (products.length === 0) return null;
  const weekly = adoption.productWeekly;
  const max = Math.max(0, ...(weekly ?? []).flatMap((d) => Object.values(d.wau)));
  const latest = weekly?.at(-1)?.date;
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">By product</h3>
      <p className="mt-0.5 mb-2 text-sm text-[var(--text-secondary)]">
        Active users per product{latest ? ` on ${latest}` : ''} · weekly active trend on a shared
        scale
      </p>
      <ScrollRegion label="Active users by product" className="overflow-x-auto">
        <table className="tabular w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--text-secondary)]">
              <th scope="col" className={`${CELL} font-medium`}>
                Product
              </th>
              {['Daily', 'Weekly', 'Monthly'].map((h) => (
                <th key={h} scope="col" className={`${CELL} text-right font-medium`}>
                  {h}
                </th>
              ))}
              <th scope="col" className="border-b border-[var(--grid)] py-1.5 font-medium">
                Weekly trend
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((row) => (
              <ProductTableRow key={row.product} row={row} weekly={weekly} max={max} />
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      {weekly && weekly.length > 0 && (
        <TableView
          columns={['Date', ...products.map((p) => `${p.label} weekly`)]}
          rows={productTrendRows(weekly, products, formatInteger)}
        />
      )}
    </div>
  );
}
