import { assertSinkPath, LEDGER_MONTH, type LedgerSink } from '@claude-audit/core';
import { bodyOf, bytesOf, jsonOf, sinkFetch, SinkHttpError, type SinkHttpOptions } from './http.js';
import { githubOidcToken, TokenCache, type AccessToken, type OidcSettings } from './oidc.js';

/**
 * `sharepoint`: a folder in a SharePoint document library or OneDrive (#161 U7), reached without
 * a stored secret: an Entra ID app with a federated credential for this repository accepts the
 * GitHub OIDC token as `client_assertion` (client credentials grant). Microsoft Graph with the
 * `Sites.Selected` application permission granted on the one site. Files up to
 * `SIMPLE_UPLOAD_LIMIT` use `PUT .../content`, larger ones an upload session in chunks.
 */
export interface SharepointSettings {
  tenantId: string;
  clientId: string;
  /** The document library (drive) of the site, or a OneDrive. */
  driveId: string;
  /** Folder path inside the drive (default `claude-audit-ledger`). */
  folder: string;
}

export const SHAREPOINT_ENDPOINTS = {
  login: 'https://login.microsoftonline.com',
  graph: 'https://graph.microsoft.com/v1.0',
} as const;

/** Simple uploads up to 4 MiB; larger files go through an upload session. */
export const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;
/** Upload session chunk: a multiple of 320 KiB as Graph requires (10 x 320 KiB). */
export const UPLOAD_CHUNK = 10 * 320 * 1024;

const ENTRA_AUDIENCE = 'api://AzureADTokenExchange';

interface DriveItem {
  name: string;
  folder?: unknown;
  file?: unknown;
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

/** Validates the configured folder path (segments of letters, digits, space, `.`, `_`, `-`). */
export function sharepointFolder(folder: string): string {
  const segments = folder.split('/').filter((s) => s !== '');
  if (segments.length === 0 || segments.some((s) => !SEGMENT.test(s) || s.includes('..')))
    throw new Error('LEDGER_SHAREPOINT_FOLDER must be a folder path such as claude-audit-ledger');
  return segments.join('/');
}

export class SharepointLedgerSink implements LedgerSink {
  readonly kind = 'sharepoint';
  private readonly tokens: TokenCache;

  constructor(
    private readonly settings: SharepointSettings,
    private readonly oidc: OidcSettings,
    private readonly http: SinkHttpOptions,
    now: () => number = Date.now,
  ) {
    this.tokens = new TokenCache(() => this.accessToken(), now);
  }

  private async accessToken(): Promise<AccessToken> {
    const assertion = await githubOidcToken('sharepoint', this.oidc, ENTRA_AUDIENCE, this.http);
    const label = 'sharepoint: Entra ID token request';
    const response = await sinkFetch(
      {
        label,
        url: `${SHAREPOINT_ENDPOINTS.login}/${encodeURIComponent(this.settings.tenantId)}/oauth2/v2.0/token`,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.settings.clientId,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials',
            client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
            client_assertion: assertion,
          }).toString(),
        },
      },
      this.http,
    );
    const body = await jsonOf<{ access_token?: string; expires_in?: number }>(response, label);
    if (!body.access_token) throw new Error(`${label}: no access token`);
    return { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3000) * 1000 };
  }

  private async auth(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.tokens.get()}` };
  }

  /** `.../drives/<drive>/root:/<folder>/<path>` with every segment encoded. */
  private item(path: string): string {
    const segments = [...sharepointFolder(this.settings.folder).split('/'), ...path.split('/')];
    return `${SHAREPOINT_ENDPOINTS.graph}/drives/${encodeURIComponent(this.settings.driveId)}/root:/${segments.map(encodeURIComponent).join('/')}`;
  }

  async put(path: string, bytes: Uint8Array): Promise<void> {
    assertSinkPath(path);
    if (bytes.byteLength <= SIMPLE_UPLOAD_LIMIT) {
      await sinkFetch(
        {
          label: `sharepoint: upload of ${path}`,
          url: `${this.item(path)}:/content?@microsoft.graph.conflictBehavior=replace`,
          init: {
            method: 'PUT',
            headers: { ...(await this.auth()), 'Content-Type': 'application/octet-stream' },
            body: bodyOf(bytes),
          },
        },
        this.http,
      );
      return;
    }
    await this.uploadSession(path, bytes);
  }

  private async uploadSession(path: string, bytes: Uint8Array): Promise<void> {
    const label = `sharepoint: upload of ${path}`;
    const created = await sinkFetch(
      {
        label,
        url: `${this.item(path)}:/createUploadSession`,
        init: {
          method: 'POST',
          headers: { ...(await this.auth()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
        },
      },
      this.http,
    );
    const { uploadUrl } = await jsonOf<{ uploadUrl?: string }>(created, label);
    if (!uploadUrl) throw new Error(`${label}: no upload session`);
    const total = bytes.byteLength;
    for (let start = 0; start < total; start += UPLOAD_CHUNK) {
      const end = Math.min(start + UPLOAD_CHUNK, total);
      // The session URL is pre-authenticated: no Authorization header (Graph documentation).
      const response = await sinkFetch(
        {
          label,
          url: uploadUrl,
          init: {
            method: 'PUT',
            headers: {
              'Content-Length': String(end - start),
              'Content-Range': `bytes ${String(start)}-${String(end - 1)}/${String(total)}`,
            },
            body: bodyOf(bytes.subarray(start, end)),
          },
          retry: false,
        },
        this.http,
      );
      if (end < total && response.status !== 202)
        throw new SinkHttpError(
          `${label}: unexpected HTTP ${String(response.status)}`,
          response.status,
        );
    }
  }

  async get(path: string): Promise<Uint8Array | null> {
    assertSinkPath(path);
    const label = `sharepoint: download of ${path}`;
    const response = await sinkFetch(
      {
        label,
        url: `${this.item(path)}:/content`,
        init: { headers: await this.auth(), redirect: 'manual' },
        accept: [302, 404],
      },
      this.http,
    );
    if (response.status === 404) return null;
    if (response.status !== 302) return bytesOf(response);
    const location = response.headers.get('location');
    if (!location) throw new Error(`${label}: no download location`);
    // The download URL is pre-authenticated: the token is never sent to it.
    return bytesOf(await sinkFetch({ label, url: location, init: {} }, this.http));
  }

  private async children(dir: string): Promise<DriveItem[] | null> {
    const label = `sharepoint: listing of ${dir}`;
    const items: DriveItem[] = [];
    let url: string | undefined = `${this.item(dir)}:/children?$select=name,folder,file&$top=200`;
    while (url) {
      const response = await sinkFetch(
        { label, url, init: { headers: await this.auth() }, accept: [404] },
        this.http,
      );
      if (response.status === 404) return null;
      const body = await jsonOf<{ value?: DriveItem[]; '@odata.nextLink'?: string }>(
        response,
        label,
      );
      items.push(...(body.value ?? []));
      url = body['@odata.nextLink'];
    }
    return items;
  }

  async list(prefix: string): Promise<string[]> {
    if (!LEDGER_MONTH.test(prefix)) throw new Error(`Invalid ledger sink month: ${prefix}`);
    const paths: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const item of (await this.children(dir)) ?? []) {
        if (item.folder === undefined) paths.push(`${dir}/${item.name}`);
        else if (!dir.includes('/')) await walk(`${dir}/${item.name}`);
      }
    };
    await walk(prefix);
    return paths.sort();
  }
}
