import { describe, expect, it } from 'vitest';
import { filterYears, formatBytes, formatSnapshotId, sizeShare } from '../archive-view';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1.0 MB'],
    [166_382_674, '158.7 MB'],
    [2 ** 30, '1.0 GB'],
    [5 * 2 ** 40 + 2 ** 39, '5.5 TB'],
    [2 ** 50, '1.0 PB'],
    [2 ** 60, '1024.0 PB'],
  ])('formats %d bytes as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it('steps up instead of showing 1024.0 of the smaller unit', () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe('1.0 MB');
    expect(formatBytes(2 ** 30 - 1)).toBe('1.0 GB');
  });

  it('shows a dash for values that are not sizes', () => {
    expect(formatBytes(-1)).toBe('–');
    expect(formatBytes(Number.NaN)).toBe('–');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('–');
  });
});

describe('formatSnapshotId', () => {
  it('turns a snapshot id into a readable UTC time', () => {
    expect(formatSnapshotId('2026-09-30T06-00-00Z')).toBe('2026-09-30 06:00 UTC');
  });
  it('returns anything else unchanged', () => {
    expect(formatSnapshotId('latest')).toBe('latest');
  });
});

describe('sizeShare', () => {
  it('is a percentage of the total and 0 for an empty archive', () => {
    expect(sizeShare(25, 100)).toBe(25);
    expect(sizeShare(0, 0)).toBe(0);
  });
});

describe('filterYears', () => {
  const years = [
    {
      year: '2025',
      snapshots: 2,
      bytes: 3,
      oldest: '2025-01-01T06-00-00Z',
      newest: '2025-09-22T06-00-00Z',
    },
    {
      year: '2024',
      snapshots: 1,
      bytes: 1,
      oldest: '2024-03-01T06-00-00Z',
      newest: '2024-03-01T06-00-00Z',
    },
  ];
  it('returns everything for an empty query and matches year or date text', () => {
    expect(filterYears(years, '  ')).toHaveLength(2);
    expect(filterYears(years, '2024').map((y) => y.year)).toEqual(['2024']);
    expect(filterYears(years, '2025-09-22').map((y) => y.year)).toEqual(['2025']);
    expect(filterYears(years, 'nothing')).toEqual([]);
  });
});
