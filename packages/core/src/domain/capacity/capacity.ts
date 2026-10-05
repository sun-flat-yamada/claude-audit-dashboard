/** Counters of `git count-objects -v` (also `-vH`), all sizes converted to bytes. */
export interface ObjectCounts {
  looseObjects: number;
  looseBytes: number;
  packedObjects: number;
  packs: number;
  packBytes: number;
  prunePackable: number;
  garbage: number;
  garbageBytes: number;
}

const UNITS: Readonly<Record<string, number>> = {
  bytes: 1,
  byte: 1,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
};

/** `12`, `12 KiB`, `1.50 MiB` -> bytes. Plain numbers are KiB for the `size*` keys of `-v`. */
function toBytes(value: string, plainUnit: number): number {
  const match = /^(\d+(?:\.\d+)?)(?:\s*([A-Za-z]+))?$/.exec(value.trim());
  if (!match) throw new Error(`Cannot parse git size: ${value}`);
  const unit = match[2] ? UNITS[match[2].toLowerCase()] : plainUnit;
  if (unit === undefined) throw new Error(`Unknown git size unit: ${match[2] ?? ''}`);
  return Math.round(Number(match[1]) * unit);
}

const SIZE_KEYS = new Set(['size', 'size-pack', 'size-garbage']);

/**
 * Parses the output of `git count-objects -v` or `-vH`. Pure; lines it does not know are
 * ignored, so a newer git adding keys does not break it, but output without any known key is
 * rejected (it is not a count-objects result).
 */
export function parseCountObjects(text: string): ObjectCounts {
  const values = new Map<string, string>();
  for (const line of text.split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) values.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  if (!values.has('count') && !values.has('in-pack')) {
    throw new Error('Not a git count-objects -v result');
  }
  const num = (key: string): number => {
    const raw = values.get(key);
    if (raw === undefined) return 0;
    return SIZE_KEYS.has(key) ? toBytes(raw, 1024) : toBytes(raw, 1);
  };
  return {
    looseObjects: num('count'),
    looseBytes: num('size'),
    packedObjects: num('in-pack'),
    packs: num('packs'),
    packBytes: num('size-pack'),
    prunePackable: num('prune-packable'),
    garbage: num('garbage'),
    garbageBytes: num('size-garbage'),
  };
}

/** Distinct blobs one dataset has in the whole history, and what they occupy. */
export interface DatasetFootprint {
  dataset: string;
  blobs: number;
  bytes: number;
}

export interface ArchiveFootprint {
  snapshots: number;
  bytes: number;
  years: number;
}

/** What a measurement of the data branch's repository yields (counts and sizes only). */
export interface RepoSizeMeasurement {
  commits: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
  objects: ObjectCounts;
  /** Disk usage of every object reachable from the measured ref(s). */
  reachableBytes: number;
  /** Length of the growth window in days. */
  windowDays: number;
  /** Bytes the last `windowDays` days added; null when the history is shorter than the window. */
  windowGrowthBytes: number | null;
  /** Distinct snapshot ids ever committed (manifests). */
  snapshots: number;
  datasets: DatasetFootprint[];
  archive: ArchiveFootprint;
}

export interface CapacityThresholds {
  /** Total reachable size limit in MiB; 0 turns the check off. */
  maxTotalMiB: number;
  /** Projected growth per 30 days in MiB; 0 turns the check off. */
  maxMonthlyGrowthMiB: number;
  /** A value at or above `limit * warnRatio` (but within the limit) is a warning. */
  warnRatio: number;
}

export type CapacityLevel = 'ok' | 'warning' | 'exceeded';

export interface CapacityFinding {
  metric: 'total' | 'monthlyGrowth';
  level: 'warning' | 'exceeded';
  valueBytes: number;
  limitBytes: number;
  message: string;
}

export interface CapacityVerdict {
  status: CapacityLevel;
  totalBytes: number;
  /** Projected growth per 30 days; null when the history is too short to tell. */
  monthlyGrowthBytes: number | null;
  findings: CapacityFinding[];
}

const MIB = 1024 ** 2;
const DAY_MS = 86_400_000;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${String(bytes)} B`;
}

/**
 * Growth per 30 days: the measured window scaled to 30 days, else (history shorter than the
 * window) the whole size spread over the history's age. Null with under one day of history.
 */
export function monthlyGrowthBytes(m: RepoSizeMeasurement): number | null {
  if (m.windowGrowthBytes !== null && m.windowDays > 0) {
    return Math.round((m.windowGrowthBytes * 30) / m.windowDays);
  }
  if (!m.firstCommitAt || !m.lastCommitAt) return null;
  const days = (Date.parse(m.lastCommitAt) - Date.parse(m.firstCommitAt)) / DAY_MS;
  return days >= 1 ? Math.round((m.reachableBytes * 30) / days) : null;
}

function judgeOne(
  metric: CapacityFinding['metric'],
  label: string,
  valueBytes: number,
  limitMiB: number,
  warnRatio: number,
): CapacityFinding | null {
  if (limitMiB <= 0) return null;
  const limitBytes = limitMiB * MIB;
  const level =
    valueBytes > limitBytes ? 'exceeded' : valueBytes >= limitBytes * warnRatio ? 'warning' : null;
  if (!level) return null;
  const verb = level === 'exceeded' ? 'exceeds' : 'is close to';
  return {
    metric,
    level,
    valueBytes,
    limitBytes,
    message: `${label} ${formatBytes(valueBytes)} ${verb} the limit of ${formatBytes(limitBytes)}`,
  };
}

/** Pure threshold judgement: compares the total and the projected monthly growth to the limits. */
export function judgeCapacity(m: RepoSizeMeasurement, t: CapacityThresholds): CapacityVerdict {
  const growth = monthlyGrowthBytes(m);
  const findings = [
    judgeOne('total', 'Total size', m.reachableBytes, t.maxTotalMiB, t.warnRatio),
    growth === null
      ? null
      : judgeOne('monthlyGrowth', 'Growth per 30 days', growth, t.maxMonthlyGrowthMiB, t.warnRatio),
  ].filter((f): f is CapacityFinding => f !== null);
  const status = findings.some((f) => f.level === 'exceeded')
    ? 'exceeded'
    : findings.length > 0
      ? 'warning'
      : 'ok';
  return { status, totalBytes: m.reachableBytes, monthlyGrowthBytes: growth, findings };
}
