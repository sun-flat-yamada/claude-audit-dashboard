const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const formatInteger = (value: number): string => integer.format(value);

/** 1,284 / 12.9K / 4.2M — for stat tiles and axis ticks. */
export const formatCompact = (value: number): string => compactNumber.format(value);

export const formatMoney = (value: number, currency = 'USD', compact = false): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value);

/** $4,776 / $12.3K — headline money without cents. */
export const formatMoneyHeadline = (value: number, currency = 'USD'): string =>
  value >= 10_000
    ? formatMoney(value, currency, true)
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(value);

export const formatPercent = (value: number): string => `${value.toFixed(1)}%`;

/** `2026-09-29T12:00:00Z` -> `2026-09-29 12:00 UTC`; date-only strings pass through. */
export const formatTimestamp = (iso: string): string =>
  iso.length <= 10 ? iso : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/** `2026-09-29` -> `09-29` for dense axes. */
export const shortDate = (date: string): string => date.slice(5, 10);
