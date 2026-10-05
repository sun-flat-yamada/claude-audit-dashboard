import { formatMoney, formatPercent } from '../lib/format';
import { monthLabel } from '../lib/monthly-view';
import { OTHER_KEY, type MixMonth } from '../lib/usage-matrix-view';

/** Categorical slots in fixed order; "Other models" is muted. Color follows the model. */
const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
export const mixColor = (index: number, key: string): string =>
  key === OTHER_KEY ? 'var(--text-muted)' : (COLORS[index] ?? 'var(--text-muted)');

export function MixLegend({ series }: { series: readonly { key: string; label: string }[] }) {
  return (
    <ul aria-label="Model mix legend" className="mb-3 flex flex-wrap gap-4 text-sm">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <span
            aria-hidden
            className="size-3 rounded-sm"
            style={{ background: mixColor(i, s.key) }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Share of the ungrouped monthly spend per model, as one 100 % bar per month. Segments are
 * separated by a surface gap, carry no animation, and every bar names its values for assistive
 * technology (the table view holds the same numbers).
 */
export function MixTrend({
  series,
  months,
  currency,
}: {
  series: readonly { key: string; label: string }[];
  months: readonly MixMonth[];
  currency: string;
}) {
  return (
    <div>
      <MixLegend series={series} />
      <ul className="space-y-3">
        {months.map((m) => {
          const label = `${monthLabel(m.month)}, total ${formatMoney(m.total, currency)}: ${m.segments
            .map((s) => `${s.label} ${formatPercent(s.share)}`)
            .join(', ')}`;
          return (
            <li key={m.month} className="grid grid-cols-[6.5rem_1fr] items-center gap-3 text-sm">
              <span className="text-[var(--text-secondary)]">{monthLabel(m.month)}</span>
              <div
                role="img"
                aria-label={label}
                title={label}
                className="flex h-6 w-full gap-0.5 overflow-hidden rounded bg-[var(--grid)]"
              >
                {m.segments.map((s, i) =>
                  s.share > 0 ? (
                    <span
                      key={s.key}
                      className="block h-full"
                      style={{ width: `${String(s.share)}%`, background: mixColor(i, s.key) }}
                    />
                  ) : null,
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
