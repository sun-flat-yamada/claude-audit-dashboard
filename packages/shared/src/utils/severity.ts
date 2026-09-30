import type { Severity } from '../types/compliance.js';

/** Severity weights for scoring */
export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 10,
  high: 5,
  medium: 3,
  low: 1,
  info: 0,
};

/** Severity display colors */
export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#d97706',
  low: '#2563eb',
  info: '#6b7280',
};

/** Sort severities from most to least critical */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_WEIGHTS[b] - SEVERITY_WEIGHTS[a];
}
