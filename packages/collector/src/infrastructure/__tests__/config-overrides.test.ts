import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTENT_VIEW_ACTIVITY_TYPES } from '@claude-audit/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { mergeConfigOverrides, parseConfigOverrides } from '../config-overrides.js';
import { readEnvironment } from '../env.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'overrides-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A marker that must never appear in an error message. */
const SECRET_MARKER = 'override-value-marker-7f3a';

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected a rejection');
}

describe('readEnvironment', () => {
  it('reads AUDIT_CONFIG_OVERRIDES and treats blank as absent', () => {
    expect(readEnvironment({}).configOverrides).toBeUndefined();
    expect(readEnvironment({ AUDIT_CONFIG_OVERRIDES: '  ' }).configOverrides).toBeUndefined();
    expect(readEnvironment({ AUDIT_CONFIG_OVERRIDES: '{}' }).configOverrides).toBe('{}');
  });
});

describe('mergeConfigOverrides', () => {
  it('merges objects deeply, replaces arrays and scalars, and keeps the inputs', () => {
    const base = { a: { b: 1, c: [1, 2], d: { e: true } }, f: 'x' };
    const merged = mergeConfigOverrides(base, { a: { c: [3], d: { g: 2 } }, f: null });
    expect(merged).toEqual({ a: { b: 1, c: [3], d: { e: true, g: 2 } }, f: null });
    expect(base).toEqual({ a: { b: 1, c: [1, 2], d: { e: true } }, f: 'x' });
  });

  it('replaces a non-object base value with the override object', () => {
    expect(mergeConfigOverrides({ a: [1] }, { a: { b: 1 } })).toEqual({ a: { b: 1 } });
    expect(mergeConfigOverrides(undefined, { a: 1 })).toEqual({ a: 1 });
  });
});

describe('parseConfigOverrides', () => {
  it('returns undefined for absent or blank values', () => {
    expect(parseConfigOverrides(undefined)).toBeUndefined();
    expect(parseConfigOverrides(' ')).toBeUndefined();
  });

  it('rejects a non-object root by type only', () => {
    expect(() => parseConfigOverrides(`["${SECRET_MARKER}"]`)).toThrow(/got an array/);
    expect(() => parseConfigOverrides(`"${SECRET_MARKER}"`)).toThrow(/got a string/);
    expect(() => parseConfigOverrides('null')).toThrow(/got null/);
  });

  it('rejects prototype keys', () => {
    expect(() => parseConfigOverrides('{"__proto__":{"polluted":true}}')).toThrow(
      /key not allowed at __proto__/,
    );
    expect(() => parseConfigOverrides('{"sources":{"constructor":{}}}')).toThrow(
      /sources\.constructor/,
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('loadConfig with overrides', () => {
  it('equals the file configuration without overrides', async () => {
    await writeFile(join(dir, 'default.json'), JSON.stringify({ retention: { snapshotDays: 30 } }));
    const plain = await loadConfig(dir);
    expect((await loadConfig(dir, undefined)).config).toEqual(plain.config);
    expect((await loadConfig(dir, '')).config).toEqual(plain.config);
    expect((await loadConfig(dir, '{}')).config).toEqual(plain.config);
  });

  it('applies a partial override on top of the file and the defaults', async () => {
    await writeFile(
      join(dir, 'default.json'),
      JSON.stringify({
        sources: { featureUsage: { lookbackDays: 60 } },
        dashboard: { title: 'T' },
      }),
    );
    const { config } = await loadConfig(dir, '{"sources":{"featureUsage":{"enabled":true}}}');
    expect(config.sources.featureUsage).toEqual({ enabled: true, lookbackDays: 60 });
    expect(config.dashboard.title).toBe('T');
    expect(config.sources.activities.excludeTypes).toEqual([...CONTENT_VIEW_ACTIVITY_TYPES]);
  });

  it('replaces arrays instead of merging them', async () => {
    await writeFile(
      join(dir, 'default.json'),
      JSON.stringify({ compliance: { disabledRules: ['CF-003', 'AC-001'] } }),
    );
    const { config } = await loadConfig(
      dir,
      JSON.stringify({
        sources: { activities: { excludeTypes: [] } },
        compliance: { disabledRules: ['UA-002'] },
      }),
    );
    expect(config.sources.activities.excludeTypes).toEqual([]);
    expect(config.compliance.disabledRules).toEqual(['UA-002']);
  });

  it('rejects invalid JSON without showing the value', async () => {
    const message = await rejection(loadConfig(dir, `{"dashboard":{"title":"${SECRET_MARKER}"`));
    expect(message).toMatch(/AUDIT_CONFIG_OVERRIDES: not valid JSON/);
    expect(message).not.toContain(SECRET_MARKER);
  });

  it('rejects a schema violation by field path and issue code only', async () => {
    const message = await rejection(
      loadConfig(
        dir,
        JSON.stringify({
          dashboard: { title: 42, maskPii: SECRET_MARKER },
          sources: { disabled: [SECRET_MARKER], claudeCode: { lookbackDays: 999 } },
          notifications: { minSeverity: SECRET_MARKER },
        }),
      ),
    );
    expect(message).toMatch(/Invalid AUDIT_CONFIG_OVERRIDES \(values not shown\)/);
    expect(message).toContain('dashboard.maskPii (invalid_type)');
    expect(message).toContain('sources.disabled.0 (custom)');
    expect(message).toContain('sources.claudeCode.lookbackDays (too_big)');
    expect(message).toContain('notifications.minSeverity (invalid_value)');
    expect(message).not.toContain(SECRET_MARKER);
    expect(message).not.toContain('999');
  });

  it('still reports an invalid file as the file', async () => {
    await writeFile(join(dir, 'default.json'), JSON.stringify({ sources: { disabled: ['nope'] } }));
    await expect(loadConfig(dir, '{}')).rejects.toThrow(/config\/default.json/);
  });
});
