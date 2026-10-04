import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../http-client.js';
import {
  FileRawCapture,
  captureFileName,
  loadCaptureEntries,
  resolveCaptureDir,
} from '../raw-capture.js';

const KEY = 'sk-ant-api01-mock000000000000000000000000';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'raw-capture-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function client(responses: Response[], capture = new FileRawCapture(join(dir, 'raw'))) {
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    // The request really carries the key; the capture must still never contain it.
    expect(JSON.stringify(init?.headers)).toContain(KEY);
    const next = responses.shift();
    if (!next) throw new Error('no response queued');
    return next;
  }) as unknown as typeof fetch;
  return new HttpClient({ apiKey: KEY, fetchImpl, sleep: async () => {}, capture });
}

const files = async () => (await readdir(join(dir, 'raw'))).sort();
const contents = async () =>
  Promise.all((await files()).map((name) => readFile(join(dir, 'raw', name), 'utf8')));

describe('raw response capture', () => {
  it('stores endpoint, query, status and body, one file per request, and never the key', async () => {
    const http = client([json({ data: [{ id: 'user_1' }] }), json({ error: { type: 'x' } }, 404)]);
    await http.getJson('/v1/organizations/users', { limit: 5, statuses: ['pending'] });
    await expect(http.getJson('/v1/missing')).rejects.toThrow(/404/);
    expect(await files()).toEqual(['0001_organizations-users.json', '0002_missing.json']);
    const [first, second] = (await contents()).map((text) => JSON.parse(text));
    expect(first).toEqual({
      request: {
        method: 'GET',
        path: '/v1/organizations/users',
        query: { limit: ['5'], 'statuses[]': ['pending'] },
      },
      response: { status: 200, body: { data: [{ id: 'user_1' }] } },
    });
    expect(second.response.status).toBe(404);
    for (const text of await contents()) {
      expect(text).not.toContain(KEY);
      expect(text.toLowerCase()).not.toContain('x-api-key');
      expect(text.toLowerCase()).not.toContain('authorization');
    }
  });

  it('scrubs the key if the API ever echoed it back', async () => {
    const http = client([json({ echo: `token ${KEY}` })]);
    await http.getJson('/v1/x');
    const [text] = await contents();
    expect(text).not.toContain(KEY);
    expect(text).toContain('[redacted]');
  });

  it('records only the final response of a retried request', async () => {
    const http = client([json({}, 429, { 'retry-after': '1' }), json({ ok: true })]);
    await http.getJson('/v1/x');
    expect(await files()).toHaveLength(1);
    expect(JSON.parse((await contents())[0] ?? '').response.status).toBe(200);
  });

  it('is off by default: no capture option, nothing written', async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true })) as unknown as typeof fetch;
    const http = new HttpClient({ apiKey: KEY, fetchImpl });
    await http.getJson('/v1/x');
    await expect(readdir(join(dir, 'raw'))).rejects.toThrow();
  });

  it('round-trips through loadCaptureEntries in request order', async () => {
    const http = client([json({ n: 1 }), json({ n: 2 })]);
    await http.getJson('/v1/a');
    await http.getJson('/v1/b');
    const entries = await loadCaptureEntries(join(dir, 'raw'));
    expect(entries.map((e) => e.request.path)).toEqual(['/v1/a', '/v1/b']);
  });
});

describe('captureFileName', () => {
  it('keeps IDs out of file names', () => {
    expect(
      captureFileName(
        3,
        '/v1/compliance/organizations/91012d09-e48b-438e-a489-1bebfd8fa6f9/settings',
      ),
    ).toBe('0003_compliance-organizations-id-settings.json');
    expect(captureFileName(12, '/v1/organizations/rbac_groups/rbac_group_01Abc/members')).toBe(
      '0012_organizations-rbac-groups-id-members.json',
    );
  });
});

describe('resolveCaptureDir', () => {
  const base = '/work/repo';

  it('accepts directories outside the repository and under the gitignored data/raw', () => {
    expect(resolveCaptureDir(base, '../captures', undefined)).toBe('/work/captures');
    expect(resolveCaptureDir(base, '/var/tmp/captures', undefined)).toBe('/var/tmp/captures');
    expect(resolveCaptureDir(base, 'data/raw/run1', undefined)).toBe('/work/repo/data/raw/run1');
  });

  it('refuses locations that Git could pick up', () => {
    expect(() => resolveCaptureDir(base, 'captures', undefined)).toThrow(/outside the repository/);
    expect(() => resolveCaptureDir(base, 'data', undefined)).toThrow(/outside the repository/);
    expect(() => resolveCaptureDir(base, '.', undefined)).toThrow(/outside the repository/);
  });

  it('is disabled in CI', () => {
    expect(() => resolveCaptureDir(base, '../captures', 'true')).toThrow(/CI/);
    expect(() => resolveCaptureDir(base, '../captures', 'false')).not.toThrow();
  });
});
