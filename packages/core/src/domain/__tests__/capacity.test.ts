import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  judgeCapacity,
  monthlyGrowthBytes,
  parseCountObjects,
  type CapacityThresholds,
  type RepoSizeMeasurement,
} from '../capacity/capacity.js';

const MIB = 1024 ** 2;

const COUNT_V = `count: 3
size: 12
in-pack: 100
packs: 2
size-pack: 2048
prune-packable: 1
garbage: 0
size-garbage: 0
`;

const COUNT_VH = `count: 3
size: 12.00 KiB
in-pack: 100
packs: 2
size-pack: 2.00 MiB
prune-packable: 1
garbage: 0
size-garbage: 0 bytes
`;

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

describe('parseCountObjects', () => {
  it('reads -v (KiB) and -vH (human readable) output to the same byte counts', () => {
    const expected = {
      looseObjects: 3,
      looseBytes: 12 * 1024,
      packedObjects: 100,
      packs: 2,
      packBytes: 2 * MIB,
      prunePackable: 1,
      garbage: 0,
      garbageBytes: 0,
    };
    expect(parseCountObjects(COUNT_V)).toEqual(expected);
    expect(parseCountObjects(COUNT_VH)).toEqual(expected);
  });

  it('ignores unknown keys and rejects output that is not a count-objects result', () => {
    expect(parseCountObjects(`${COUNT_V}future-key: 9\n`).packs).toBe(2);
    expect(() => parseCountObjects('fatal: not a git repository')).toThrow(/count-objects/);
    expect(() => parseCountObjects('count: many\n')).toThrow(/Cannot parse/);
    expect(() => parseCountObjects('count: 1\nsize: 3 parsecs\n')).toThrow(/unit/);
  });
});

describe('monthlyGrowthBytes', () => {
  it('scales the window to 30 days', () => {
    expect(monthlyGrowthBytes(measurement({ windowDays: 15, windowGrowthBytes: MIB }))).toBe(
      2 * MIB,
    );
  });

  it('falls back to the size spread over the history age, and is null under one day', () => {
    const short = measurement({ windowGrowthBytes: null });
    // 10 MiB over 59 days -> 30 days.
    expect(monthlyGrowthBytes(short)).toBe(Math.round((10 * MIB * 30) / 59));
    expect(
      monthlyGrowthBytes(
        measurement({ windowGrowthBytes: null, lastCommitAt: '2026-01-01T06:00:00.000Z' }),
      ),
    ).toBeNull();
    expect(
      monthlyGrowthBytes(measurement({ windowGrowthBytes: null, firstCommitAt: null })),
    ).toBeNull();
  });
});

describe('judgeCapacity', () => {
  it('is ok below the warning ratio', () => {
    const verdict = judgeCapacity(measurement(), LIMITS);
    expect(verdict).toMatchObject({ status: 'ok', findings: [], totalBytes: 10 * MIB });
  });

  it('warns from limit * ratio up to the limit, and exceeds above it', () => {
    const at = (bytes: number) =>
      judgeCapacity(measurement({ reachableBytes: bytes, windowGrowthBytes: 0 }), LIMITS);
    expect(at(79 * MIB).status).toBe('ok');
    expect(at(80 * MIB).status).toBe('warning');
    expect(at(100 * MIB).status).toBe('warning');
    expect(at(100 * MIB + 1).status).toBe('exceeded');
  });

  it('judges the projected growth separately and reports every finding', () => {
    const verdict = judgeCapacity(
      measurement({ reachableBytes: 120 * MIB, windowGrowthBytes: 9 * MIB }),
      LIMITS,
    );
    expect(verdict.status).toBe('exceeded');
    expect(verdict.findings.map((f) => [f.metric, f.level])).toEqual([
      ['total', 'exceeded'],
      ['monthlyGrowth', 'warning'],
    ]);
    expect(verdict.monthlyGrowthBytes).toBe(9 * MIB);
  });

  it('turns a check off with a limit of 0 and skips growth when it is unknown', () => {
    const big = measurement({ reachableBytes: 9999 * MIB, windowGrowthBytes: 9999 * MIB });
    expect(judgeCapacity(big, { ...LIMITS, maxTotalMiB: 0, maxMonthlyGrowthMiB: 0 }).status).toBe(
      'ok',
    );
    const unknown = measurement({ windowGrowthBytes: null, firstCommitAt: null });
    expect(judgeCapacity(unknown, LIMITS).monthlyGrowthBytes).toBeNull();
  });
});

describe('formatBytes', () => {
  it('uses the largest fitting binary unit', () => {
    expect(formatBytes(5)).toBe('5 B');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(3 * MIB)).toBe('3.0 MiB');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.00 GiB');
  });
});
