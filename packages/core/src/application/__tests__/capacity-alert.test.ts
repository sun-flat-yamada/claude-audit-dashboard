import { describe, expect, it } from 'vitest';
import {
  judgeCapacity,
  type CapacityThresholds,
  type RepoSizeMeasurement,
} from '../../domain/capacity/capacity.js';
import { capacityAlert } from '../capacity-alert.js';

const MIB = 1024 ** 2;

function measurement(over: Partial<RepoSizeMeasurement> = {}): RepoSizeMeasurement {
  return {
    commits: 10,
    firstCommitAt: '2026-01-01T00:00:00.000Z',
    lastCommitAt: '2026-03-01T00:00:00.000Z',
    objects: {
      looseObjects: 0,
      looseBytes: 0,
      packedObjects: 0,
      packs: 0,
      packBytes: 0,
      prunePackable: 0,
      garbage: 0,
      garbageBytes: 0,
    },
    reachableBytes: 10 * MIB,
    windowDays: 30,
    windowGrowthBytes: 2 * MIB,
    snapshots: 10,
    datasets: [],
    archive: { snapshots: 0, bytes: 0, years: 0 },
    ...over,
  };
}

const LIMITS: CapacityThresholds = { maxTotalMiB: 100, maxMonthlyGrowthMiB: 10, warnRatio: 0.8 };

describe('capacityAlert', () => {
  it('is null when everything is within limits', () => {
    expect(capacityAlert(judgeCapacity(measurement(), LIMITS))).toBeNull();
  });

  it('carries sizes only, a severity per level and a stable key', () => {
    const exceeded = capacityAlert(
      judgeCapacity(measurement({ reachableBytes: 150 * MIB }), LIMITS),
      'https://dashboard.example.com',
    );
    expect(exceeded).toMatchObject({
      key: 'capacity:exceeded',
      severity: 'high',
      link: 'https://dashboard.example.com',
    });
    expect(exceeded?.title).toBe('data/audit size exceeded: 150.0 MiB');
    expect(exceeded?.lines[0]).toBe(
      '[EXCEEDED] Total size 150.0 MiB exceeds the limit of 100.0 MiB',
    );
    const warning = capacityAlert(
      judgeCapacity(measurement({ reachableBytes: 90 * MIB, windowGrowthBytes: 0 }), LIMITS),
    );
    expect(warning).toMatchObject({ key: 'capacity:warning', severity: 'medium' });
  });
});
