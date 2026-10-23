/**
 * HTTP fakes of the GitHub OIDC endpoint, Google STS / IAM Credentials / Drive API v3 and Entra ID
 * / Microsoft Graph, following the request and response shapes of the official documentation.
 * Synthetic identifiers and tokens only (assembled so that no value looks like a real key).
 */

export const OIDC_REQUEST_URL = 'https://token.actions.example.com/oidc?api-version=2.0';
export const OIDC_REQUEST_TOKEN = 'request-token-mock-0000';
export const OIDC_JWT = 'oidc-jwt-mock-0000';

export const oidcVariables = {
  ACTIONS_ID_TOKEN_REQUEST_URL: OIDC_REQUEST_URL,
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: OIDC_REQUEST_TOKEN,
};

export interface Recorded {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

export interface Failure {
  match: (r: Recorded) => boolean;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  /** Network error instead of a response. */
  network?: boolean;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const textOf = (body: unknown): string =>
  typeof body === 'string' ? body : new TextDecoder().decode(body as Uint8Array);

/** The shared part: recording, injected failures and the OIDC endpoint. */
abstract class FakeService {
  readonly requests: Recorded[] = [];
  readonly failures: Failure[] = [];
  readonly oidcAudiences: string[] = [];

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const r: Recorded = {
      method: init.method ?? 'GET',
      url: String(input),
      headers: new Headers(init.headers),
      body: init.body,
    };
    this.requests.push(r);
    const at = this.failures.findIndex((f) => f.match(r));
    if (at >= 0) {
      const [failure] = this.failures.splice(at, 1);
      if (failure?.network) throw new TypeError(`fetch failed: ${r.url}`);
      return json(failure?.body ?? {}, failure?.status ?? 500, failure?.headers);
    }
    const url = new URL(r.url);
    if (url.host === 'token.actions.example.com') return this.oidc(r, url);
    return this.handle(r, url);
  };

  private oidc(r: Recorded, url: URL): Response {
    if (r.headers.get('authorization') !== `Bearer ${OIDC_REQUEST_TOKEN}`) return json({}, 401);
    this.oidcAudiences.push(url.searchParams.get('audience') ?? '');
    return json({ value: OIDC_JWT });
  }

  protected abstract handle(r: Recorded, url: URL): Promise<Response> | Response;

  count(pred: (r: Recorded) => boolean): number {
    return this.requests.filter(pred).length;
  }
}

// ─── Google ─────────────────────────────────────────────────────────────────

export const GOOGLE = {
  provider: 'projects/123456/locations/global/workloadIdentityPools/pool-x/providers/github-x',
  serviceAccount: 'ledger-sa@project-x.iam.gserviceaccount.com',
  driveId: 'drive-id-mock-0001',
  folderId: 'folder-id-mock-0001',
  federated: 'federated-token-mock-0001',
  access: 'drive-token-mock-0001',
};

export const gdriveVariables = {
  ...oidcVariables,
  LEDGER_GDRIVE_WORKLOAD_IDENTITY_PROVIDER: GOOGLE.provider,
  LEDGER_GDRIVE_SERVICE_ACCOUNT: GOOGLE.serviceAccount,
  LEDGER_GDRIVE_DRIVE_ID: GOOGLE.driveId,
  LEDGER_GDRIVE_FOLDER_ID: GOOGLE.folderId,
};

interface DriveNode {
  id: string;
  name: string;
  mimeType: string;
  parent: string;
  data?: Uint8Array;
}

export class FakeGoogle extends FakeService {
  readonly nodes = new Map<string, DriveNode>();
  readonly stsBodies: Record<string, unknown>[] = [];
  private readonly sessions = new Map<
    string,
    { fileId?: string | undefined; name?: string | undefined; parent?: string | undefined }
  >();
  private next = 1;

  /** Path (`2026-09/usage.jsonl.gz`) of a node below the root folder. */
  pathOf(node: DriveNode): string {
    const parts = [node.name];
    let parent = this.nodes.get(node.parent);
    while (parent) {
      parts.unshift(parent.name);
      parent = this.nodes.get(parent.parent);
    }
    return parts.join('/');
  }

  /** Stored files by path. */
  files(): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    for (const node of this.nodes.values()) if (node.data) files.set(this.pathOf(node), node.data);
    return files;
  }

  protected handle(r: Recorded, url: URL): Response {
    if (url.host === 'sts.googleapis.com') return this.sts(r);
    if (url.host === 'iamcredentials.googleapis.com') return this.iam(r, url);
    if (
      r.headers.get('authorization') !== `Bearer ${GOOGLE.access}` &&
      !url.searchParams.has('upload_id')
    )
      return json({ error: { code: 401, status: 'UNAUTHENTICATED' } }, 401);
    if (url.pathname === '/drive/v3/files' && r.method === 'GET') return this.list(url);
    if (url.pathname === '/drive/v3/files' && r.method === 'POST') return this.folder(r);
    if (url.pathname.startsWith('/upload/drive/v3/files')) return this.upload(r, url);
    const media = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (media && url.searchParams.get('alt') === 'media')
      return this.media(decodeURIComponent(media[1] ?? ''));
    return json({ error: { code: 404, status: 'NOT_FOUND' } }, 404);
  }

  private sts(r: Recorded): Response {
    const body = JSON.parse(textOf(r.body)) as Record<string, unknown>;
    this.stsBodies.push(body);
    if (body.subjectToken !== OIDC_JWT) return json({ error: 'invalid_grant' }, 400);
    return json({ access_token: GOOGLE.federated, token_type: 'Bearer', expires_in: 3600 });
  }

  private iam(r: Recorded, url: URL): Response {
    const expected = `/v1/projects/-/serviceAccounts/${encodeURIComponent(GOOGLE.serviceAccount)}:generateAccessToken`;
    if (
      url.pathname !== expected ||
      r.headers.get('authorization') !== `Bearer ${GOOGLE.federated}`
    )
      return json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403);
    return json({ accessToken: GOOGLE.access, expireTime: '2099-01-01T00:00:00Z' });
  }

  private list(url: URL): Response {
    if (
      url.searchParams.get('driveId') !== GOOGLE.driveId ||
      url.searchParams.get('supportsAllDrives') !== 'true'
    )
      return json({ error: { code: 400, errors: [{ reason: 'badRequest' }] } }, 400);
    const q = url.searchParams.get('q') ?? '';
    const parent = /^'([^']+)' in parents/.exec(q)?.[1];
    const name = /name = '([^']+)'/.exec(q)?.[1];
    const all = [...this.nodes.values()].filter(
      (n) => n.parent === parent && (name === undefined || n.name === name),
    );
    // Two per page, to exercise nextPageToken.
    const start = Number(url.searchParams.get('pageToken') ?? '0');
    const page = all.slice(start, start + 2);
    return json({
      files: page.map(({ id, name: n, mimeType }) => ({ id, name: n, mimeType })),
      ...(start + 2 < all.length ? { nextPageToken: String(start + 2) } : {}),
    });
  }

  private add(name: string, mimeType: string, parent: string): DriveNode {
    const node = { id: `id-${String(this.next++)}`, name, mimeType, parent };
    this.nodes.set(node.id, node);
    return node;
  }

  private folder(r: Recorded): Response {
    const body = JSON.parse(textOf(r.body)) as {
      name: string;
      mimeType: string;
      parents: string[];
    };
    return json({ id: this.add(body.name, body.mimeType, body.parents[0] ?? '').id });
  }

  private upload(r: Recorded, url: URL): Response {
    const sessionId = url.searchParams.get('upload_id');
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session || r.method !== 'PUT') return json({}, 404);
      const node = session.fileId
        ? this.nodes.get(session.fileId)
        : this.add(session.name ?? '', 'application/octet-stream', session.parent ?? '');
      if (!node) return json({}, 404);
      node.data = new Uint8Array(r.body as Uint8Array);
      return json({ id: node.id });
    }
    if (url.searchParams.get('uploadType') !== 'resumable') return json({}, 400);
    const update = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)?.[1];
    const meta = JSON.parse(textOf(r.body)) as { name?: string; parents?: string[] };
    const id = String(this.next++);
    this.sessions.set(
      id,
      update
        ? { fileId: decodeURIComponent(update) }
        : { name: meta.name, parent: meta.parents?.[0] },
    );
    return new Response(null, {
      status: 200,
      headers: {
        Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}`,
      },
    });
  }

  private media(id: string): Response {
    const node = this.nodes.get(id);
    if (!node?.data) return json({ error: { code: 404 } }, 404);
    return new Response(Uint8Array.from(node.data), { status: 200 });
  }

  /** The root folder id used in folder lookups. */
  get root(): string {
    return GOOGLE.folderId;
  }
}

// ─── Microsoft ──────────────────────────────────────────────────────────────

export const MICROSOFT = {
  tenantId: 'tenant-id-mock-0001',
  clientId: 'client-id-mock-0001',
  driveId: 'drive-id-mock-0002',
  access: 'graph-token-mock-0001',
};

export const sharepointVariables = {
  ...oidcVariables,
  LEDGER_SHAREPOINT_TENANT_ID: MICROSOFT.tenantId,
  LEDGER_SHAREPOINT_CLIENT_ID: MICROSOFT.clientId,
  LEDGER_SHAREPOINT_DRIVE_ID: MICROSOFT.driveId,
};

export class FakeMicrosoft extends FakeService {
  /** Stored files by path inside the drive (`claude-audit-ledger/2026-09/usage.jsonl.gz`). */
  readonly items = new Map<string, Uint8Array>();
  readonly tokenForms: URLSearchParams[] = [];
  /** Authorization headers sent to the pre-authenticated download and upload URLs. */
  readonly leakedAuth: string[] = [];
  private readonly sessions = new Map<
    string,
    { path: string; parts: Uint8Array[]; total: number }
  >();
  private next = 1;

  protected handle(r: Recorded, url: URL): Response {
    if (url.host === 'login.microsoftonline.com') return this.token(r, url);
    if (url.host === 'upload.sharepoint.example.com') return this.chunk(r, url);
    if (url.host === 'download.sharepoint.example.com') return this.download(r, url);
    if (r.headers.get('authorization') !== `Bearer ${MICROSOFT.access}`)
      return json({ error: { code: 'InvalidAuthenticationToken' } }, 401);
    const prefix = `/v1.0/drives/${MICROSOFT.driveId}/root:/`;
    if (!url.pathname.startsWith(prefix)) return json({ error: { code: 'itemNotFound' } }, 404);
    const rest = url.pathname.slice(prefix.length);
    const [rawPath = '', action = ''] = rest.split(':/');
    const path = rawPath.split('/').map(decodeURIComponent).join('/');
    if (action === 'content' && r.method === 'PUT') return this.simple(r, path, url);
    if (action === 'content' && r.method === 'GET') return this.redirect(path);
    if (action === 'createUploadSession') return this.session(path);
    if (action === 'children') return this.children(path, url);
    return json({ error: { code: 'invalidRequest' } }, 400);
  }

  private token(r: Recorded, url: URL): Response {
    const form = new URLSearchParams(textOf(r.body));
    this.tokenForms.push(form);
    const ok =
      url.pathname === `/${MICROSOFT.tenantId}/oauth2/v2.0/token` &&
      form.get('client_assertion') === OIDC_JWT &&
      form.get('client_id') === MICROSOFT.clientId &&
      form.get('grant_type') === 'client_credentials';
    if (!ok)
      return json(
        { error: 'invalid_client', error_description: `AADSTS70021 ${MICROSOFT.tenantId}` },
        400,
      );
    return json({ access_token: MICROSOFT.access, token_type: 'Bearer', expires_in: 3599 });
  }

  private simple(r: Recorded, path: string, url: URL): Response {
    if (url.searchParams.get('@microsoft.graph.conflictBehavior') !== 'replace')
      return json({}, 400);
    this.items.set(path, new Uint8Array(r.body as Uint8Array));
    return json({ id: `item-${path}`, name: path.split('/').at(-1) }, 201);
  }

  private redirect(path: string): Response {
    if (!this.items.has(path)) return json({ error: { code: 'itemNotFound' } }, 404);
    return new Response(null, {
      status: 302,
      headers: {
        Location: `https://download.sharepoint.example.com/${encodeURIComponent(path)}?tempauth=mock`,
      },
    });
  }

  private download(r: Recorded, url: URL): Response {
    const auth = r.headers.get('authorization');
    if (auth) this.leakedAuth.push(auth);
    const data = this.items.get(decodeURIComponent(url.pathname.slice(1)));
    return data ? new Response(Uint8Array.from(data)) : json({}, 404);
  }

  private session(path: string): Response {
    const id = String(this.next++);
    this.sessions.set(id, { path, parts: [], total: 0 });
    return json({
      uploadUrl: `https://upload.sharepoint.example.com/session/${id}`,
      expirationDateTime: '2099-01-01T00:00:00Z',
    });
  }

  private chunk(r: Recorded, url: URL): Response {
    const auth = r.headers.get('authorization');
    if (auth) this.leakedAuth.push(auth);
    const session = this.sessions.get(url.pathname.split('/').at(-1) ?? '');
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('content-range') ?? '');
    if (!session || !range) return json({ error: { code: 'invalidRange' } }, 416);
    const body = new Uint8Array(r.body as Uint8Array);
    const [start, end, total] = [Number(range[1]), Number(range[2]), Number(range[3])];
    const received = session.parts.reduce((n, p) => n + p.byteLength, 0);
    if (start !== received || end - start + 1 !== body.byteLength)
      return json({ error: { code: 'invalidRange' } }, 416);
    session.parts.push(body);
    if (end + 1 < total) return json({ nextExpectedRanges: [`${String(end + 1)}-`] }, 202);
    const all = new Uint8Array(total);
    let at = 0;
    for (const part of session.parts) {
      all.set(part, at);
      at += part.byteLength;
    }
    this.items.set(session.path, all);
    return json({ id: `item-${session.path}` }, 201);
  }

  private children(path: string, url: URL): Response {
    const prefix = `${path}/`;
    const names = new Map<string, boolean>();
    for (const key of this.items.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length).split('/');
      names.set(rest[0] ?? '', rest.length > 1);
    }
    if (names.size === 0) return json({ error: { code: 'itemNotFound' } }, 404);
    const all = [...names]
      .sort()
      .map(([name, folder]) => (folder ? { name, folder: { childCount: 1 } } : { name, file: {} }));
    const start = Number(url.searchParams.get('$skiptoken') ?? '0');
    const next = new URL(url.href);
    next.searchParams.set('$skiptoken', String(start + 2));
    return json({
      value: all.slice(start, start + 2),
      ...(start + 2 < all.length ? { '@odata.nextLink': next.href } : {}),
    });
  }
}

/** Routes the cloud hosts to a fake and everything else to `fallback` (a synthetic tenant). */
export function routed(fake: FakeService, fallback: typeof fetch): typeof fetch {
  const hosts =
    /(googleapis\.com|microsoftonline\.com|graph\.microsoft\.com|sharepoint\.example\.com|token\.actions\.example\.com)$/;
  return ((input: string | URL | Request, init?: RequestInit) =>
    hosts.test(new URL(String(input)).host)
      ? fake.fetch(input, init)
      : fallback(input, init)) as typeof fetch;
}
