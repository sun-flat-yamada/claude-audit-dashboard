import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FilesystemLedgerSink, filesystemSinkRoot } from '../filesystem.js';
import { GdriveLedgerSink } from '../gdrive.js';
import { sinkFetch, SINK_HTTP_ATTEMPTS } from '../http.js';
import { createLedgerSink, LEDGER_SINKS, type LedgerSinkContext } from '../registry.js';
import { SharepointLedgerSink, SIMPLE_UPLOAD_LIMIT, UPLOAD_CHUNK } from '../sharepoint.js';
import {
  FakeGoogle,
  FakeMicrosoft,
  GOOGLE,
  MICROSOFT,
  OIDC_JWT,
  OIDC_REQUEST_TOKEN,
  OIDC_REQUEST_URL,
  gdriveVariables,
  oidcVariables,
  sharepointVariables,
} from './fake-cloud.js';

const roots: string[] = [];
const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'ledger-sink-'));
  roots.push(dir);
  return dir;
};
afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

const enc = new TextEncoder();
const dec = new TextDecoder();
const http = (fetchImpl: typeof fetch) => {
  const delays: number[] = [];
  return {
    delays,
    options: {
      fetchImpl,
      sleep: async (ms: number) => {
        delays.push(ms);
      },
    },
  };
};

/** Every value that must never appear in a log line or an error message. */
const SECRETS = [
  OIDC_JWT,
  OIDC_REQUEST_TOKEN,
  OIDC_REQUEST_URL,
  'token.actions.example.com',
  'googleapis.com',
  'graph.microsoft.com',
  'microsoftonline.com',
  'sharepoint.example.com',
  ...Object.values(GOOGLE),
  ...Object.values(MICROSOFT),
];

async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected a rejection');
}

const expectClean = (message: string) => {
  for (const secret of SECRETS) expect(message).not.toContain(secret);
};

describe('sinkFetch', () => {
  const respond = (...statuses: (number | 'network')[]) => {
    let call = 0;
    return (async () => {
      const status = statuses[Math.min(call++, statuses.length - 1)];
      if (status === 'network')
        throw new TypeError(`fetch failed: https://${GOOGLE.driveId}.example`);
      return new Response(JSON.stringify({ error: { code: 'tooManyRequests' } }), {
        status,
        headers: status === 429 ? { 'Retry-After': '2' } : {},
      });
    }) as unknown as typeof fetch;
  };
  const request = { label: 'test upload of 2026-09/a', url: 'https://x.example.com/', init: {} };

  it('retries network errors, 429 (Retry-After) and 5xx with backoff', async () => {
    const { delays, options } = http(respond('network', 429, 503, 200));
    const response = await sinkFetch(request, options);
    expect(response.status).toBe(200);
    expect(delays).toEqual([500, 2000, 2000]);
  });

  it('gives up after the last attempt and names the status and API code only', async () => {
    const { delays, options } = http(respond(503));
    const message = await errorOf(sinkFetch(request, options));
    expect(message).toBe('test upload of 2026-09/a failed (HTTP 503, tooManyRequests)');
    expect(delays).toHaveLength(SINK_HTTP_ATTEMPTS - 1);
  });

  it('does not retry a client error, a non-repeatable request, or report the network cause', async () => {
    const forbidden = http(respond(403, 200));
    expect(await errorOf(sinkFetch(request, forbidden.options))).toMatch(/HTTP 403/);
    expect(forbidden.delays).toEqual([]);
    const once = http(respond(503, 200));
    await expect(sinkFetch({ ...request, retry: false }, once.options)).rejects.toThrow(/HTTP 503/);
    const network = http(respond('network'));
    const message = await errorOf(sinkFetch(request, network.options));
    expect(message).toBe('test upload of 2026-09/a failed (network error)');
    expectClean(message);
  });

  it('returns accepted statuses', async () => {
    const { options } = http(respond(404));
    expect((await sinkFetch({ ...request, accept: [404] }, options)).status).toBe(404);
  });
});

describe('filesystem sink', () => {
  it('stores, reads back and lists files in the ledger layout', async () => {
    const root = await tempDir();
    const sink = new FilesystemLedgerSink(root);
    await sink.put('2026-09/usage.jsonl.gz', enc.encode('a'));
    await sink.put('2026-09/revisions/cost.jsonl.gz.enc', enc.encode('b'));
    await sink.put('2026-09/usage.jsonl.gz', enc.encode('c'));
    expect(dec.decode((await sink.get('2026-09/usage.jsonl.gz')) ?? undefined)).toBe('c');
    expect(await sink.get('2026-09/none.jsonl.gz')).toBeNull();
    expect(await sink.list('2026-09')).toEqual([
      '2026-09/revisions/cost.jsonl.gz.enc',
      '2026-09/usage.jsonl.gz',
    ]);
    expect(await sink.list('2026-10')).toEqual([]);
    await expect(sink.put('2026-09/../x', enc.encode('x'))).rejects.toThrow(
      /Invalid ledger sink path/,
    );
  });

  it('reports errors without the directory', async () => {
    const root = await tempDir();
    const sink = new FilesystemLedgerSink(join(root, 'file'));
    await new FilesystemLedgerSink(root).put('2026-09/a.jsonl.gz', enc.encode('x'));
    const blocked = new FilesystemLedgerSink(join(root, '2026-09', 'a.jsonl.gz'));
    const message = await errorOf(blocked.put('2026-09/b.jsonl.gz', enc.encode('x')));
    expect(message).toMatch(/^filesystem: cannot write 2026-09\/b\.jsonl\.gz \(E[A-Z]+\)$/);
    expect(message).not.toContain(root);
    expect(await sink.list('2026-09')).toEqual([]);
  });

  it('refuses a directory inside the data directory or the repository', () => {
    expect(() => filesystemSinkRoot('data/copy', '/repo', '/repo/data')).toThrow(
      /outside the data directory/,
    );
    expect(() => filesystemSinkRoot('/elsewhere/../repo/x', '/repo', '/data')).toThrow(/outside/);
    expect(filesystemSinkRoot('../copies', '/repo', '/repo/data')).toBe('/copies');
  });
});

describe('gdrive sink (Drive API v3, Workload Identity Federation)', () => {
  const sinkOf = (google: FakeGoogle) => {
    const h = http(google.fetch as typeof fetch);
    const sink = createLedgerSink('gdrive', {
      variables: gdriveVariables,
      baseDir: '/repo',
      dataDir: '/repo/data',
      http: h.options,
    });
    return { sink: sink as GdriveLedgerSink, delays: h.delays };
  };

  it('exchanges the OIDC token once, creates month folders and uploads, updates and reads back', async () => {
    const google = new FakeGoogle();
    const { sink } = sinkOf(google);
    await sink.put('2026-09/usage.jsonl.gz', enc.encode('one'));
    await sink.put('2026-09/revisions/usage.jsonl.gz', enc.encode('rev'));
    await sink.put('2026-09/usage.jsonl.gz', enc.encode('two'));
    await sink.put('2026-09/cost.jsonl.gz', enc.encode('c'));
    await sink.put('2026-09/MANIFEST.json', enc.encode('{}'));
    expect([...google.files().keys()].sort()).toEqual([
      '2026-09/MANIFEST.json',
      '2026-09/cost.jsonl.gz',
      '2026-09/revisions/usage.jsonl.gz',
      '2026-09/usage.jsonl.gz',
    ]);
    expect(dec.decode((await sink.get('2026-09/usage.jsonl.gz')) ?? undefined)).toBe('two');
    expect(await sink.get('2026-09/missing.jsonl.gz')).toBeNull();
    expect(await sink.get('2026-10/usage.jsonl.gz')).toBeNull();
    expect(await sink.list('2026-09')).toEqual([
      '2026-09/MANIFEST.json',
      '2026-09/cost.jsonl.gz',
      '2026-09/revisions/usage.jsonl.gz',
      '2026-09/usage.jsonl.gz',
    ]);
    expect(await sink.list('2026-10')).toEqual([]);
    // One folder per month, one revisions folder; the update replaced the file in place.
    const folders = [...google.nodes.values()].filter((n) => n.mimeType.endsWith('folder'));
    expect(folders.map((f) => google.pathOf(f)).sort()).toEqual(['2026-09', '2026-09/revisions']);
    expect(google.count((r) => r.method === 'PATCH')).toBe(1);
    // The whole run used one token exchange, with the documented parameters.
    expect(google.oidcAudiences).toEqual([`https://iam.googleapis.com/${GOOGLE.provider}`]);
    expect(google.stsBodies).toEqual([
      expect.objectContaining({
        grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
        audience: `//iam.googleapis.com/${GOOGLE.provider}`,
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
        requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      }),
    ]);
    // The upload session URL carries no bearer token.
    for (const r of google.requests.filter((q) => q.url.includes('upload_id=')))
      expect(r.headers.get('authorization')).toBeNull();
  });

  it('retries a transient Drive failure', async () => {
    const google = new FakeGoogle();
    const { sink, delays } = sinkOf(google);
    google.failures.push(
      { match: (r) => r.url.includes('/drive/v3/files?') && r.method === 'GET', status: 503 },
      {
        match: (r) => r.url.includes('uploadType=resumable') && !r.url.includes('upload_id'),
        status: 429,
        headers: { 'Retry-After': '1' },
      },
    );
    await sink.put('2026-09/usage.jsonl.gz', enc.encode('x'));
    expect(delays).toEqual([500, 1000]);
    expect(google.files().size).toBe(1);
  });

  it('never reports tokens, URLs or IDs', async () => {
    const google = new FakeGoogle();
    const { sink } = sinkOf(google);
    google.failures.push({
      match: (r) => r.url.includes('iamcredentials'),
      status: 403,
      body: {
        error: {
          code: 403,
          message: `denied for ${GOOGLE.serviceAccount}`,
          status: 'PERMISSION_DENIED',
        },
      },
    });
    const denied = await errorOf(sink.put('2026-09/usage.jsonl.gz', enc.encode('x')));
    expect(denied).toBe(
      'gdrive: service account impersonation failed (HTTP 403, PERMISSION_DENIED)',
    );
    google.failures.push({
      match: (r) => r.url.includes('upload_id'),
      status: 500,
      body: { error: { message: GOOGLE.folderId } },
    });
    const failed = await errorOf(sink.put('2026-09/usage.jsonl.gz', enc.encode('x')));
    expect(failed).toBe('gdrive: upload of 2026-09/usage.jsonl.gz failed (HTTP 500)');
    for (const message of [denied, failed]) expectClean(message);
  });

  it('needs the OIDC token and its variables', async () => {
    const variables = { ...gdriveVariables, ACTIONS_ID_TOKEN_REQUEST_URL: '' };
    const sink = createLedgerSink('gdrive', {
      variables,
      baseDir: '/r',
      dataDir: '/r/d',
      http: {},
    });
    expect(await errorOf(sink!.list('2026-09'))).toMatch(/permissions: id-token: write/);
    expect(() =>
      createLedgerSink('gdrive', {
        variables: oidcVariables,
        baseDir: '/r',
        dataDir: '/r/d',
        http: {},
      }),
    ).toThrow(
      'ledger.sink gdrive needs the variable(s) LEDGER_GDRIVE_WORKLOAD_IDENTITY_PROVIDER, LEDGER_GDRIVE_SERVICE_ACCOUNT, LEDGER_GDRIVE_DRIVE_ID, LEDGER_GDRIVE_FOLDER_ID',
    );
  });
});

describe('sharepoint sink (Microsoft Graph, Entra ID federated credential)', () => {
  const sinkOf = (microsoft: FakeMicrosoft, extra: Record<string, string> = {}) => {
    const h = http(microsoft.fetch as typeof fetch);
    const context: LedgerSinkContext = {
      variables: { ...sharepointVariables, ...extra },
      baseDir: '/repo',
      dataDir: '/repo/data',
      http: h.options,
    };
    return {
      sink: createLedgerSink('sharepoint', context) as SharepointLedgerSink,
      delays: h.delays,
    };
  };

  it('uploads small files directly, large ones in session chunks, and reads back via the redirect', async () => {
    const microsoft = new FakeMicrosoft();
    const { sink } = sinkOf(microsoft);
    const large = new Uint8Array(SIMPLE_UPLOAD_LIMIT + UPLOAD_CHUNK + 7).map((_, i) => i % 251);
    await sink.put('2026-09/usage.jsonl.gz', enc.encode('small'));
    await sink.put('2026-09/activities.jsonl.gz.enc', large);
    await sink.put('2026-09/revisions/cost.jsonl.gz', enc.encode('rev'));
    await sink.put('2026-09/MANIFEST.json', enc.encode('{}'));
    expect([...microsoft.items.keys()].sort()).toEqual([
      'claude-audit-ledger/2026-09/MANIFEST.json',
      'claude-audit-ledger/2026-09/activities.jsonl.gz.enc',
      'claude-audit-ledger/2026-09/revisions/cost.jsonl.gz',
      'claude-audit-ledger/2026-09/usage.jsonl.gz',
    ]);
    const chunks = microsoft.requests.filter((r) => r.url.includes('upload.sharepoint'));
    expect(chunks).toHaveLength(Math.ceil(large.byteLength / UPLOAD_CHUNK));
    expect(UPLOAD_CHUNK % (320 * 1024)).toBe(0);
    const back = (await sink.get('2026-09/activities.jsonl.gz.enc')) ?? new Uint8Array();
    expect(Buffer.compare(Buffer.from(back), Buffer.from(large))).toBe(0);
    expect(dec.decode((await sink.get('2026-09/usage.jsonl.gz')) ?? undefined)).toBe('small');
    expect(await sink.get('2026-09/none.jsonl.gz')).toBeNull();
    // Paged listing (two per page) including revisions/.
    expect(await sink.list('2026-09')).toEqual([
      '2026-09/MANIFEST.json',
      '2026-09/activities.jsonl.gz.enc',
      '2026-09/revisions/cost.jsonl.gz',
      '2026-09/usage.jsonl.gz',
    ]);
    expect(await sink.list('2026-10')).toEqual([]);
    // The token never goes to the pre-authenticated upload / download URLs.
    expect(microsoft.leakedAuth).toEqual([]);
    expect(microsoft.oidcAudiences).toEqual(['api://AzureADTokenExchange']);
    expect(microsoft.tokenForms).toHaveLength(1);
    expect(microsoft.tokenForms[0]?.get('client_assertion_type')).toBe(
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    );
    expect(microsoft.tokenForms[0]?.get('scope')).toBe('https://graph.microsoft.com/.default');
  });

  it('uses the configured folder and refuses a path that leaves it', async () => {
    const microsoft = new FakeMicrosoft();
    const { sink } = sinkOf(microsoft, { LEDGER_SHAREPOINT_FOLDER: 'Audit/Ledger copies' });
    await sink.put('2026-09/usage.jsonl.gz', enc.encode('x'));
    expect([...microsoft.items.keys()]).toEqual(['Audit/Ledger copies/2026-09/usage.jsonl.gz']);
    expect(() => sinkOf(microsoft, { LEDGER_SHAREPOINT_FOLDER: '../x' })).toThrow(
      /LEDGER_SHAREPOINT_FOLDER/,
    );
  });

  it('retries throttling (Retry-After) and server errors', async () => {
    const microsoft = new FakeMicrosoft();
    const { sink, delays } = sinkOf(microsoft);
    microsoft.failures.push(
      { match: (r) => r.url.includes('/oauth2/'), status: 503 },
      {
        match: (r) => r.url.includes(':/content') && r.method === 'PUT',
        status: 429,
        headers: { 'Retry-After': '3' },
      },
      { match: (r) => r.url.includes('download.'), network: true, status: 0 },
    );
    await sink.put('2026-09/usage.jsonl.gz', enc.encode('x'));
    expect(dec.decode((await sink.get('2026-09/usage.jsonl.gz')) ?? undefined)).toBe('x');
    expect(delays).toEqual([500, 3000, 500]);
  });

  it('never reports tokens, URLs or IDs', async () => {
    const microsoft = new FakeMicrosoft();
    const { sink } = sinkOf(microsoft, { LEDGER_SHAREPOINT_CLIENT_ID: 'other-client-mock' });
    const denied = await errorOf(sink.put('2026-09/usage.jsonl.gz', enc.encode('x')));
    expect(denied).toBe('sharepoint: Entra ID token request failed (HTTP 400, invalid_client)');
    const ok = sinkOf(microsoft).sink;
    microsoft.failures.push({
      match: (r) => r.url.includes(':/content'),
      status: 403,
      body: { error: { code: 'accessDenied', message: `site ${MICROSOFT.driveId}` } },
    });
    const forbidden = await errorOf(ok.put('2026-09/usage.jsonl.gz', enc.encode('x')));
    expect(forbidden).toBe(
      'sharepoint: upload of 2026-09/usage.jsonl.gz failed (HTTP 403, accessDenied)',
    );
    for (const message of [denied, forbidden]) expectClean(message);
  });
});

describe('ledger sink registry', () => {
  const context = (variables: Record<string, string>): LedgerSinkContext => ({
    variables,
    baseDir: '/repo',
    dataDir: '/repo/data',
    http: {},
  });

  it('registers the three kinds and creates none for none', () => {
    expect(LEDGER_SINKS.keys()).toEqual(['filesystem', 'gdrive', 'sharepoint']);
    expect(createLedgerSink('none', context({}))).toBeNull();
    expect(createLedgerSink('filesystem', context({ LEDGER_SINK_DIR: '/copies' }))?.kind).toBe(
      'filesystem',
    );
    expect(createLedgerSink('sharepoint', context(sharepointVariables))?.kind).toBe('sharepoint');
  });

  it('names an unknown kind and missing variables (never values)', () => {
    expect(() => createLedgerSink('s3', context({}))).toThrow(
      'Unknown ledger sink: s3 (available: filesystem, gdrive, sharepoint)',
    );
    expect(() => createLedgerSink('filesystem', context({}))).toThrow(
      'ledger.sink filesystem needs the variable(s) LEDGER_SINK_DIR',
    );
    expect(() => createLedgerSink('sharepoint', context(oidcVariables))).toThrow(
      /LEDGER_SHAREPOINT_TENANT_ID, LEDGER_SHAREPOINT_CLIENT_ID, LEDGER_SHAREPOINT_DRIVE_ID$/,
    );
  });
});
