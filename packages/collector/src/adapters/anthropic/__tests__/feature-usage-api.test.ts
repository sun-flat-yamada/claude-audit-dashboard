import { fileURLToPath } from 'node:url';
import { DataUnavailableError, gatherDatasets } from '@claude-audit/core';
import { describe, expect, it, vi } from 'vitest';
import { FEATURE_PATHS, FeatureUsageApi } from '../feature-usage-api.js';
import { HttpClient } from '../http-client.js';
import { createOptionalCollectors } from '../optional-collectors.js';
import { SchemaDriftError } from '../paginate.js';
import { loadCaptureEntries } from '../raw-capture.js';
import { replayFetch } from '../replay-fetch.js';
import { withOptionalFixtures } from '../../fixture/optional-fixture.js';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const KEY = 'sk-ant-api01-mock000000000000000000000000';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The gateway on the official-shape fixtures (two skill pages, nulls, a project creator). */
async function onFixtures() {
  const base = replayFetch(await loadCaptureEntries(`${FIXTURES}tenant`));
  const replay = await withOptionalFixtures(base, FIXTURES);
  const http = new HttpClient({ apiKey: KEY, fetchImpl: replay.fetch, sleep: async () => {} });
  return { replay, api: new FeatureUsageApi(http) };
}

/** Every request answered by `respond`; requests are recorded. */
function faked(respond: (url: URL) => Response) {
  const fetchImpl = vi.fn(async (input: string | URL | Request) =>
    respond(new URL(input instanceof Request ? input.url : String(input))),
  ) as unknown as typeof fetch;
  const http = new HttpClient({ apiKey: KEY, fetchImpl, sleep: async () => {} });
  return { api: new FeatureUsageApi(http), fetchImpl };
}

const settings = {
  disabled: [],
  console: { enabled: false, lookbackDays: 30 },
  claudeCode: { enabled: false, lookbackDays: 7 },
  featureUsage: { enabled: true, lookbackDays: 30 },
};
const context = { now: NOW, range: { start: new Date('2026-08-31T00:00:00Z'), end: NOW } };

describe('FeatureUsageApi on the official-shape fixtures', () => {
  it('rolls skills up over the window across two pages and keeps nulls', async () => {
    const { api, replay } = await onFixtures();
    const result = await api.skills(30, NOW);
    expect(result.window).toEqual({ from: '2026-08-31T00:00:00.000Z', to: NOW.toISOString() });
    expect(result.items.map((s) => s.name)).toEqual([
      'docx',
      'skill_01DemoExampleBrandVoice',
      'xlsx',
      'skill_01DemoPrivateSkill',
    ]);
    expect(result.items[1]).toEqual({
      name: 'skill_01DemoExampleBrandVoice',
      displayName: 'Example Brand Voice',
      users: 22,
      invocations: 140,
      shareStatus: 'organization',
      chatConversations: 96,
      claudeCodeSessions: 12,
      coworkSessions: 8,
      officeSessions: null,
    });
    // Office sessions are the sum of the stated products; unknown ones stay out.
    expect(result.items[0]?.officeSessions).toBe(9);
    expect(result.items[2]).toMatchObject({ officeSessions: 21, coworkSessions: null });
    expect(result.items[3]).toMatchObject({ invocations: null, chatConversations: null });
    const [first, second] = replay.calls;
    expect(first?.pathname).toBe(FEATURE_PATHS.skills);
    expect(first?.searchParams.get('starting_date')).toBe('2026-08-31');
    expect(first?.searchParams.has('ending_date')).toBe(false);
    expect(first?.searchParams.get('limit')).toBe('1000');
    expect(first?.searchParams.has('group_by[]')).toBe(false);
    expect(second?.searchParams.get('page')).toBe('page_demo_skills_2');
  });

  it('maps connectors with the read / write / unclassified split and the resolved name', async () => {
    const { api } = await onFixtures();
    const { items } = await api.connectors(30, NOW);
    expect(items[0]).toEqual({
      name: 'github',
      displayName: null,
      users: 19,
      readCalls: 420,
      writeCalls: 85,
      unclassifiedCalls: 30,
      managedAuthUsers: 15,
      individualAuthUsers: 4,
      chatConversations: 44,
      claudeCodeSessions: 120,
      coworkSessions: 6,
      officeSessions: null,
    });
    expect(items[1]?.officeSessions).toBe(6);
    expect(items[2]).toMatchObject({
      displayName: 'Example Wiki',
      readCalls: null,
      writeCalls: null,
      managedAuthUsers: null,
    });
  });

  it('maps plugins, including a redacted id and an unknown install count', async () => {
    const { api } = await onFixtures();
    const { items } = await api.plugins(30, NOW);
    expect(items).toEqual([
      {
        name: 'code-review',
        pluginId: 'code-review@example-marketplace',
        users: 11,
        invocations: 230,
        installs: 9,
        claudeCodeSessions: 64,
        coworkSessions: null,
      },
      {
        name: 'third-party-plugin',
        pluginId: null,
        users: 3,
        invocations: 17,
        installs: null,
        claudeCodeSessions: 5,
        coworkSessions: 3,
      },
    ]);
  });

  it('never keeps the project creator', async () => {
    const { api } = await onFixtures();
    const { items } = await api.projects(30, NOW);
    expect(items[0]).toEqual({
      id: 'claude_proj_01DemoOnboarding',
      name: 'Example Onboarding Handbook',
      users: 12,
      messages: 340,
      conversations: 58,
      createdAt: '2026-03-02T09:00:00Z',
    });
    expect(items[1]).toMatchObject({ conversations: null, createdAt: null });
    const text = JSON.stringify(items);
    for (const personal of ['user_alice', '@example.com', 'user_01DemoAlice', 'created_by'])
      expect(text, personal).not.toContain(personal);
  });
});

describe('FeatureUsageApi request window and errors', () => {
  it('never asks for data before the Analytics API epoch', async () => {
    const { api, fetchImpl } = faked(() => json({ data: [], next_page: null }));
    await api.plugins(366, new Date('2026-03-01T00:00:00Z'));
    const url = new URL(String(vi.mocked(fetchImpl).mock.calls[0]?.[0]));
    expect(url.searchParams.get('starting_date')).toBe('2026-01-01');
  });

  it('reports a changed response shape as schema drift naming the endpoint', async () => {
    const { api } = faked(() => json({ data: [{ project_name: 'x' }], next_page: null }));
    await expect(api.projects(30, NOW)).rejects.toThrow(SchemaDriftError);
    await expect(api.projects(30, NOW)).rejects.toThrow(FEATURE_PATHS.projects);
  });

  it.each([401, 403, 404])('makes HTTP %i unavailable through the collector', async (status) => {
    const { api } = faked((url) =>
      url.pathname === FEATURE_PATHS.connectors
        ? json({ type: 'error', error: { type: 'permission_error', message: 'denied' } }, status)
        : json({ data: [], next_page: null }),
    );
    const collectors = createOptionalCollectors(
      { console: null, claudeCode: null, featureUsage: api },
      settings,
    );
    const connector = collectors.find((c) => c.dataset === 'connectorUsage');
    await expect(connector?.collect({ ...context, cursor: undefined })).rejects.toThrow(
      DataUnavailableError,
    );
    const gathered = await gatherDatasets(collectors, context);
    expect(gathered.coverage.connectorUsage?.status).toBe('unavailable');
    expect(gathered.coverage.skillUsage?.status).toBe('ok');
    expect(gathered.coverage.chatProjectUsage?.status).toBe('ok');
  });
});
