export interface BarItem {
  key: string;
  label: string;
  /** Bar length (relative to the largest value in the list). */
  value: number;
  /** Visible value label at the bar tip, formatted by the caller. */
  display: string;
}

/**
 * Horizontal bars for one measure over nominal categories: one hue (slot 1) for every bar,
 * <=24px thick, 4px rounded data-end, value at the tip. Every value is also a visible label.
 * `wrap` lets long labels wrap instead of being truncated (long names next to a long value).
 */
export function ShareBars({ items, wrap = false }: { items: readonly BarItem[]; wrap?: boolean }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.key} title={`${item.label}: ${item.display}`} className="group">
          <div className="flex justify-between gap-3 text-sm">
            <span className={wrap ? 'min-w-0 [overflow-wrap:anywhere]' : 'truncate'}>
              {item.label}
            </span>
            <span className="tabular shrink-0 text-[var(--text-secondary)]">{item.display}</span>
          </div>
          <div className="mt-1 h-3">
            <div
              className="h-3 rounded-r bg-[var(--series-1)] transition-opacity group-hover:opacity-80"
              style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
