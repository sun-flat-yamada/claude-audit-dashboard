import { resolve } from 'node:path';
import {
  capacityAlert,
  errorMessage,
  formatBytes,
  judgeCapacity,
  pruneLastSent,
  type CapacityVerdict,
} from '@claude-audit/core';
import { measureRepository, type Measured } from '../adapters/storage/git-size.js';
import type { Container } from './container.js';
import { deliver } from './deliver.js';

export interface SizeOptions {
  /** Repository to measure (default: the current directory). */
  repo?: string | undefined;
  /** Ref to measure (default: every ref); the data branch is `data/audit`. */
  ref?: string | undefined;
  /** Send the warning through the configured notification channels. */
  notify: boolean;
  /** Log the result as JSON (sizes and counts only). */
  json: boolean;
  /** A failed measurement or notification is logged as a warning and never an error. */
  warnOnly: boolean;
}

export interface SizeResult {
  measurement: Measured;
  verdict: CapacityVerdict;
}

/** Fixed-width text lines: totals, then one row per dataset by size. Counts and sizes only. */
export function describeMeasurement({ measurement: m, verdict }: SizeResult): string[] {
  const growth = verdict.monthlyGrowthBytes;
  const rows = [...m.datasets]
    .sort((a, b) => b.bytes - a.bytes)
    .map(
      (d) =>
        `  ${d.dataset.padEnd(16)} ${String(d.blobs).padStart(7)} blobs ${formatBytes(d.bytes).padStart(10)}`,
    );
  return [
    `Capacity ${verdict.status}: ${formatBytes(verdict.totalBytes)} reachable in ${String(m.commits)} commits (${String(m.snapshots)} snapshots)`,
    `  growth per 30 days ${growth === null ? 'unknown (history too short)' : formatBytes(growth)}; packs ${formatBytes(m.objects.packBytes)}, loose ${formatBytes(m.objects.looseBytes)}`,
    `  archive ${String(m.archive.snapshots)} snapshots in ${String(m.archive.years)} year(s), ${formatBytes(m.archive.bytes)}`,
    ...rows,
    ...verdict.findings.map((f) => `  [${f.level.toUpperCase()}] ${f.message}`),
  ];
}

async function notifyOnce(c: Container, verdict: CapacityVerdict): Promise<void> {
  const alert = capacityAlert(verdict, c.env.dashboardUrl);
  if (!alert) return;
  const now = c.clock.now();
  const { cooldownMinutes } = c.config.notifications;
  const { lastSent } = (await c.state.load()).notifications;
  if (alert.key in pruneLastSent(lastSent, now, cooldownMinutes)) {
    c.logger.info(`Capacity alert ${alert.key} is within its cooldown`);
    return;
  }
  await deliver(c, alert, now);
  // Reload: `deliver` has appended the send record to the history.
  const state = await c.state.load();
  await c.state.save({
    ...state,
    notifications: {
      ...state.notifications,
      lastSent: {
        ...pruneLastSent(lastSent, now, cooldownMinutes),
        [alert.key]: now.toISOString(),
      },
    },
  });
}

async function measure(c: Container, options: SizeOptions): Promise<SizeResult> {
  const { capacity } = c.config;
  const measurement = await measureRepository(resolve(c.env.baseDir, options.repo ?? '.'), {
    ref: options.ref,
    windowDays: capacity.windowDays,
  });
  return { measurement, verdict: judgeCapacity(measurement, capacity) };
}

/**
 * Measures the repository, judges it against `config.capacity` and optionally notifies. With
 * `warnOnly` (the collection workflow) no failure escapes: it is logged as a warning, so a
 * broken measurement can never fail a collection.
 */
export async function runSize(c: Container, options: SizeOptions): Promise<SizeResult | null> {
  try {
    const result = await measure(c, options);
    if (options.json)
      c.logger.info(JSON.stringify({ ...result.measurement, ...result.verdict }, null, 2));
    else for (const line of describeMeasurement(result)) c.logger.info(line);
    if (options.notify) await notifyOnce(c, result.verdict);
    return result;
  } catch (error) {
    if (!options.warnOnly) throw error;
    c.logger.warn(`Size measurement skipped: ${errorMessage(error)}`);
    return null;
  }
}
