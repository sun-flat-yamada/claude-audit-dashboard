import { DataUnavailableError, gatherDatasets } from '@claude-audit/core';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeApi } from '../claude-code-api.js';
import { ConsoleAdminApi } from '../console-admin-api.js';
import { HttpClient } from '../http-client.js';
import {
  createOptionalCollectors,
  type OptionalApis,
  type OptionalSettings,
} from '../optional-collectors.js';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const context = { now: NOW, range: { start: new Date('2026-08-31T00:00:00Z'), end: NOW } };

const off: OptionalSettings = {
  disabled: [],
  console: { enabled: false, lookbackDays: 30 },
  claudeCode: { enabled: false, lookbackDays: 7 },
};
const none: OptionalApis = { console: null, claudeCode: null };

const names = (collectors: { dataset: string }[]) => collectors.map((c) => c.dataset);

describe('createOptionalCollectors (registration)', () => {
  it('registers nothing by default, with or without gateways', () => {
    expect(createOptionalCollectors(none, off)).toEqual([]);
    const http = new HttpClient({
      apiKey: 'k',
      fetchImpl: (async () => new Response('{}')) as never,
    });
    const apis = { console: new ConsoleAdminApi(http), claudeCode: new ClaudeCodeApi(http) };
    expect(createOptionalCollectors(apis, off)).toEqual([]);
  });

  it('registers each source only when its flag is on', () => {
    const consoleOn = { ...off, console: { ...off.console, enabled: true } };
    const claudeOn = { ...off, claudeCode: { ...off.claudeCode, enabled: true } };
    expect(names(createOptionalCollectors(none, consoleOn))).toEqual([
      'consoleWorkspaces',
      'consoleApiKeys',
      'consoleUsage',
      'consoleCost',
    ]);
    expect(names(createOptionalCollectors(none, claudeOn))).toEqual(['claudeCodeActivity']);
  });

  it('skips datasets listed in sources.disabled', () => {
    const on = {
      disabled: ['consoleApiKeys', 'members'] as const,
      console: { enabled: true, lookbackDays: 30 },
      claudeCode: { enabled: true, lookbackDays: 7 },
    };
    expect(names(createOptionalCollectors(none, { ...on, disabled: [...on.disabled] }))).toEqual([
      'consoleWorkspaces',
      'consoleUsage',
      'consoleCost',
      'claudeCodeActivity',
    ]);
  });

  it('without a gateway every enabled collector is unavailable and names the variable', async () => {
    const on = {
      ...off,
      console: { enabled: true, lookbackDays: 30 },
      claudeCode: { enabled: true, lookbackDays: 7 },
    };
    const collectors = createOptionalCollectors(none, on);
    for (const collector of collectors)
      await expect(collector.collect({ ...context, cursor: undefined })).rejects.toThrow(
        DataUnavailableError,
      );
    const gathered = await gatherDatasets(collectors, context);
    for (const meta of Object.values(gathered.coverage)) {
      expect(meta.status).toBe('unavailable');
      expect(meta.reason).toContain('ANTHROPIC_CONSOLE_ADMIN_API_KEY');
      expect(meta.reason).toContain('Enterprise keys do not work');
    }
    expect(Object.keys(gathered.coverage)).toHaveLength(5);
  });
});
