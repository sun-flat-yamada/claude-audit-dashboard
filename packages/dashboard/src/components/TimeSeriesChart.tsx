import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { shortDate } from '../lib/format';
import { TableView } from './Card';

export interface Series {
  key: string;
  label: string;
  /** A categorical slot token, assigned in fixed order: var(--series-1), var(--series-2), ... */
  color: string;
}

type Row = { date: string } & Record<string, string | number>;

interface Props {
  data: readonly Row[];
  series: readonly Series[];
  /** Exact values (tooltip, table view). */
  format: (value: number) => string;
  /** Axis ticks; defaults to `format`. */
  tickFormat?: (value: number) => string;
  domain?: [number, number];
  height?: number;
}

const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 12 };
const ACTIVE_DOT = { r: 4, stroke: 'var(--surface-1)', strokeWidth: 2 };

/** Values lead, series names follow; rows are keyed with a short line in the series color. */
function ChartTooltip({
  active,
  payload,
  label,
  format,
}: TooltipContentProps & { format: Props['format'] }) {
  if (!active || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm shadow-sm">
      <p className="text-[var(--text-secondary)]">{String(label)}</p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-3" style={{ background: entry.color }} />
          <strong className="tabular">{format(Number(entry.value))}</strong>
          <span className="text-[var(--text-secondary)]">{entry.name}</span>
        </p>
      ))}
    </div>
  );
}

/** Legend mirrors the mark (a line key) and is shown only for two or more series. */
const Legend = ({ series }: { series: readonly Series[] }) => (
  <ul className="mb-2 flex flex-wrap gap-4 text-sm text-[var(--text-secondary)]">
    {series.map((s) => (
      <li key={s.key} className="flex items-center gap-1.5">
        <span aria-hidden className="h-0.5 w-4 rounded" style={{ background: s.color }} />
        {s.label}
      </li>
    ))}
  </ul>
);

const MARK = {
  type: 'linear',
  strokeWidth: 2,
  activeDot: ACTIVE_DOT,
  isAnimationActive: false,
} as const;

/** Single series: a line with a 10% area wash; several series: plain 2px lines. */
const seriesMark = (s: Series, single: boolean) =>
  single ? (
    <Area
      key={s.key}
      dataKey={s.key}
      name={s.label}
      stroke={s.color}
      fill={s.color}
      fillOpacity={0.1}
      {...MARK}
    />
  ) : (
    <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} dot={false} {...MARK} />
  );

const tableRows = (data: Props['data'], series: Props['series'], format: Props['format']) =>
  data.map((row) => [row.date, ...series.map((s) => format(Number(row[s.key])))]);

/**
 * One chart for every daily trend: a single series renders as a line with a 10% area wash
 * (the card title names it), several series as 2px lines with a legend. One y-axis only.
 */
export function TimeSeriesChart({
  data,
  series,
  format,
  tickFormat = format,
  domain,
  height = 240,
}: Props) {
  const single = series.length === 1;
  return (
    <figure>
      {!single && <Legend series={series} />}
      <ComposedChart
        responsive
        data={[...data]}
        style={{ width: '100%', height }}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tick={AXIS_TICK}
          stroke="var(--axis)"
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={tickFormat}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={64}
          domain={domain ?? [0, 'auto']}
        />
        <Tooltip
          content={(props) => <ChartTooltip {...props} format={format} />}
          cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
        />
        {series.map((s) => seriesMark(s, single))}
      </ComposedChart>
      <TableView
        columns={['Date', ...series.map((s) => s.label)]}
        rows={tableRows(data, series, format)}
      />
    </figure>
  );
}
