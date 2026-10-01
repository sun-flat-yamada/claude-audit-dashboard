/** Decimal string in minor units (cents), as returned by Anthropic cost and spend APIs. */
export const MINOR_AMOUNT = /^-?\d+(\.\d+)?$/;

/**
 * Converts a minor-unit decimal string (`"41280.125"` cents) to major units (`412.80125`).
 * Callers validate the format with {@link MINOR_AMOUNT} at the API boundary.
 */
export function minorToMajor(amount: string): number {
  return Number((Number(amount) / 100).toFixed(6));
}

export const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

export const percent = (part: number, whole: number): number =>
  whole === 0 ? 0 : round((part / whole) * 100, 1);

export const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const COUNT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** `29775326` -> `29,775,326` (locale-independent output). */
export const formatCount = (value: number): string => COUNT.format(value);
