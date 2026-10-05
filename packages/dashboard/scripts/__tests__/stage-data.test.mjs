import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveSource, stage } from '../stage-data.mjs';

describe('resolveSource', () => {
  const root = '/repo';
  const has =
    (...present) =>
    (file) =>
      present.some((p) => file === join(root, p));

  it('keeps the default order: live data if present, else sample', () => {
    expect(resolveSource(undefined, root, has('data/dashboard.json')).file).toBe(
      join(root, 'data/dashboard.json'),
    );
    expect(resolveSource('', root, has()).file).toBe(join(root, 'data/sample/dashboard.json'));
  });

  it('sample never reads live data even when it exists', () => {
    const r = resolveSource('sample', root, has('data/dashboard.json'));
    expect(r).toEqual({ name: 'sample', file: join(root, 'data/sample/dashboard.json') });
  });

  it('fixtures reads data/fixture and fails with a hint when absent', () => {
    expect(resolveSource('fixtures', root, has('data/fixture/dashboard.json')).file).toBe(
      join(root, 'data/fixture/dashboard.json'),
    );
    expect(() => resolveSource('fixtures', root, has())).toThrow(/pnpm fixture/);
  });

  it('live fails when data/dashboard.json is absent', () => {
    expect(() => resolveSource('live', root, has())).toThrow(/DASHBOARD_DATA_SOURCE=live/);
    expect(resolveSource('live', root, has('data/dashboard.json')).name).toBe('live');
  });

  it('rejects unknown values', () => {
    expect(() => resolveSource('prod', root, has())).toThrow(/Unknown DASHBOARD_DATA_SOURCE/);
  });
});

describe('stage', () => {
  let tmp;
  let pkgRoot;
  const write = (rel, content) => {
    const file = join(tmp, rel);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  };
  const target = () => join(pkgRoot, 'public', 'data', 'dashboard.json');
  const quiet = () => undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'stage-data-'));
    pkgRoot = join(tmp, 'packages', 'dashboard');
    mkdirSync(pkgRoot, { recursive: true });
    write('data/sample/dashboard.json', 'SAMPLE');
    write('data/fixture/dashboard.json', 'FIXTURE');
    write('data/dashboard.json', 'LIVE');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it.each([
    [undefined, 'LIVE'],
    ['sample', 'SAMPLE'],
    ['fixtures', 'FIXTURE'],
    ['live', 'LIVE'],
  ])('DASHBOARD_DATA_SOURCE=%s stages %s', (source, expected) => {
    stage({ env: { DASHBOARD_DATA_SOURCE: source }, pkgRoot, log: quiet });
    expect(readFileSync(target(), 'utf-8')).toBe(expected);
  });

  it('STAGED_DATA=1 keeps a pre-staged file untouched', () => {
    write('packages/dashboard/public/data/dashboard.json', 'CI');
    stage({ env: { STAGED_DATA: '1', DASHBOARD_DATA_SOURCE: 'sample' }, pkgRoot, log: quiet });
    expect(readFileSync(target(), 'utf-8')).toBe('CI');
  });

  it('STAGED_DATA=1 without a pre-staged file falls through to staging', () => {
    stage({ env: { STAGED_DATA: '1', DASHBOARD_DATA_SOURCE: 'sample' }, pkgRoot, log: quiet });
    expect(readFileSync(target(), 'utf-8')).toBe('SAMPLE');
  });

  it('live without data/dashboard.json throws instead of falling back', () => {
    rmSync(join(tmp, 'data', 'dashboard.json'));
    expect(() => stage({ env: { DASHBOARD_DATA_SOURCE: 'live' }, pkgRoot, log: quiet })).toThrow();
  });

  describe('detail files', () => {
    it('stages the effective configuration with the detail directory (same publication rule)', () => {
      stage({ env: { DASHBOARD_DATA_SOURCE: 'sample' }, pkgRoot, log: quiet });
      expect(readFileSync(staged('config.json'), 'utf-8')).toBe('SAMPLE-CONFIG');
    });

    it('stages the archive inventory with the detail directory (same publication rule)', () => {
      stage({ env: { DASHBOARD_DATA_SOURCE: 'sample' }, pkgRoot, log: quiet });
      expect(readFileSync(staged('archive.json'), 'utf-8')).toBe('SAMPLE-ARCHIVE');
    });

    it('stages the monthly cost files with the detail directory (same publication rule)', () => {
      stage({ env: { DASHBOARD_DATA_SOURCE: 'sample' }, pkgRoot, log: quiet });
      expect(readFileSync(staged('monthly/index.json'), 'utf-8')).toBe('SAMPLE-MONTHLY');
    });

    const staged = (rel) => join(pkgRoot, 'public', 'data', 'detail', rel);

    beforeEach(() => {
      write('data/sample/detail/index.json', 'SAMPLE-INDEX');
      write('data/sample/detail/members.json', 'SAMPLE-MEMBERS');
      write('data/fixture/detail/index.json', 'FIXTURE-INDEX');
      write('data/detail/index.json', 'LIVE-INDEX');
      write('data/detail/activity-2026-09.json', 'LIVE-ACTIVITY');
      write('data/sample/detail/monthly/index.json', 'SAMPLE-MONTHLY');
      write('data/sample/detail/config.json', 'SAMPLE-CONFIG');
      write('data/sample/detail/archive.json', 'SAMPLE-ARCHIVE');
    });

    it.each([
      ['sample', 'SAMPLE-INDEX'],
      ['fixtures', 'FIXTURE-INDEX'],
      ['live', 'LIVE-INDEX'],
      [undefined, 'LIVE-INDEX'],
    ])("DASHBOARD_DATA_SOURCE=%s stages that source's detail directory", (source, expected) => {
      stage({ env: { DASHBOARD_DATA_SOURCE: source }, pkgRoot, log: quiet });
      expect(readFileSync(staged('index.json'), 'utf-8')).toBe(expected);
    });

    it('copies every file of the directory', () => {
      stage({ env: { DASHBOARD_DATA_SOURCE: 'live' }, pkgRoot, log: quiet });
      expect(readFileSync(staged('activity-2026-09.json'), 'utf-8')).toBe('LIVE-ACTIVITY');
    });

    it('removes a stale staged detail directory when the source has none', () => {
      stage({ env: { DASHBOARD_DATA_SOURCE: 'sample' }, pkgRoot, log: quiet });
      expect(existsSync(staged('members.json'))).toBe(true);
      rmSync(join(tmp, 'data', 'fixture', 'detail'), { recursive: true });
      stage({ env: { DASHBOARD_DATA_SOURCE: 'fixtures' }, pkgRoot, log: quiet });
      expect(existsSync(staged('index.json'))).toBe(false);
      expect(existsSync(staged('members.json'))).toBe(false);
    });

    it('does not stage a detail directory without a manifest', () => {
      rmSync(join(tmp, 'data', 'sample', 'detail', 'index.json'));
      stage({ env: { DASHBOARD_DATA_SOURCE: 'sample' }, pkgRoot, log: quiet });
      expect(existsSync(staged('members.json'))).toBe(false);
    });

    it('STAGED_DATA=1 leaves CI-staged detail files untouched', () => {
      write('packages/dashboard/public/data/dashboard.json', 'CI');
      write('packages/dashboard/public/data/detail/index.json', 'CI-INDEX');
      stage({ env: { STAGED_DATA: '1', DASHBOARD_DATA_SOURCE: 'sample' }, pkgRoot, log: quiet });
      expect(readFileSync(staged('index.json'), 'utf-8')).toBe('CI-INDEX');
    });
  });
});
