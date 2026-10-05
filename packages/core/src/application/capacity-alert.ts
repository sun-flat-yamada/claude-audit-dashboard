import { formatBytes, type CapacityVerdict } from '../domain/capacity/capacity.js';
import type { AlertMessage } from './ports.js';

/** The notification for a verdict; null when everything is within limits. Sizes and counts only. */
export function capacityAlert(verdict: CapacityVerdict, link?: string): AlertMessage | null {
  if (verdict.status === 'ok') return null;
  return {
    key: `capacity:${verdict.status}`,
    title: `data/audit size ${verdict.status}: ${formatBytes(verdict.totalBytes)}`,
    severity: verdict.status === 'exceeded' ? 'high' : 'medium',
    lines: [
      ...verdict.findings.map((f) => `[${f.level.toUpperCase()}] ${f.message}`),
      'Rotate the data branch or move old history out (docs/DEPLOYMENT.md, long-term retention).',
    ],
    link,
  };
}
