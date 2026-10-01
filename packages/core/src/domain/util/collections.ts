export const sumBy = <T>(items: readonly T[], value: (item: T) => number): number =>
  items.reduce((total, item) => total + value(item), 0);

export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = groups.get(k);
    if (bucket) bucket.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/** Sums `value` per key, preserving first-seen key order. */
export function totalsBy<T>(
  items: readonly T[],
  key: (item: T) => string,
  value: (item: T) => number,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    totals.set(k, (totals.get(k) ?? 0) + value(item));
  }
  return totals;
}

export const countBy = <T>(items: readonly T[], key: (item: T) => string): Map<string, number> =>
  totalsBy(items, key, () => 1);

export function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Map entries sorted by value, descending. */
export const sortedByValue = (map: ReadonlyMap<string, number>): [string, number][] =>
  [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
