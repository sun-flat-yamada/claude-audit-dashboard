import { assertSinkPath, LEDGER_MONTH, type LedgerSink } from '@claude-audit/core';
import { bodyOf, bytesOf, jsonOf, sinkFetch, type SinkHttpOptions } from './http.js';
import { githubOidcToken, TokenCache, type AccessToken, type OidcSettings } from './oidc.js';

/**
 * `gdrive`: a folder in a Google Drive shared drive (#161 U7), reached without a stored key:
 * the GitHub OIDC token is exchanged at Google STS for a federated token (Workload Identity
 * Federation), which impersonates a service account through IAM Credentials
 * (`generateAccessToken`, scope `drive`). Drive API v3 with `supportsAllDrives`: one folder per
 * month (and its `revisions/`) under the root folder, files uploaded with resumable sessions.
 */
export interface GdriveSettings {
  /** `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`. */
  workloadIdentityProvider: string;
  /** E-mail of the service account the federated identity may impersonate. */
  serviceAccount: string;
  /** The shared drive. */
  driveId: string;
  /** Root folder of the copies inside the shared drive (may be the drive itself). */
  folderId: string;
}

export const GDRIVE_ENDPOINTS = {
  sts: 'https://sts.googleapis.com/v1/token',
  iam: 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts',
  drive: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3',
} as const;

const FOLDER = 'application/vnd.google-apps.folder';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

/** A Drive query string literal. */
const literal = (value: string): string =>
  `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

export class GdriveLedgerSink implements LedgerSink {
  readonly kind = 'gdrive';
  private readonly tokens: TokenCache;
  private readonly folders = new Map<string, string>();

  constructor(
    private readonly settings: GdriveSettings,
    private readonly oidc: OidcSettings,
    private readonly http: SinkHttpOptions,
    now: () => number = Date.now,
  ) {
    this.tokens = new TokenCache(() => this.accessToken(), now);
  }

  private async accessToken(): Promise<AccessToken> {
    const provider = this.settings.workloadIdentityProvider;
    const oidc = await githubOidcToken(
      'gdrive',
      this.oidc,
      `https://iam.googleapis.com/${provider}`,
      this.http,
    );
    const sts = await sinkFetch(
      {
        label: 'gdrive: STS token exchange',
        url: GDRIVE_ENDPOINTS.sts,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
            audience: `//iam.googleapis.com/${provider}`,
            scope: 'https://www.googleapis.com/auth/cloud-platform',
            requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
            subjectToken: oidc,
            subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
          }),
        },
      },
      this.http,
    );
    const federated = await jsonOf<{ access_token?: string }>(sts, 'gdrive: STS token exchange');
    return this.impersonate(federated.access_token);
  }

  private async impersonate(federated: string | undefined): Promise<AccessToken> {
    const label = 'gdrive: service account impersonation';
    if (!federated) throw new Error(`${label}: no federated token`);
    const response = await sinkFetch(
      {
        label,
        url: `${GDRIVE_ENDPOINTS.iam}/${encodeURIComponent(this.settings.serviceAccount)}:generateAccessToken`,
        init: {
          method: 'POST',
          headers: { Authorization: `Bearer ${federated}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: [DRIVE_SCOPE], lifetime: '3600s' }),
        },
      },
      this.http,
    );
    const body = await jsonOf<{ accessToken?: string; expireTime?: string }>(response, label);
    if (!body.accessToken) throw new Error(`${label}: no access token`);
    const expiresAt = body.expireTime ? Date.parse(body.expireTime) : Number.NaN;
    return {
      token: body.accessToken,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 3_000_000,
    };
  }

  private async auth(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.tokens.get()}` };
  }

  /** Children of a folder (all pages), optionally only the one named `name`. */
  private async children(parent: string, label: string, name?: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${GDRIVE_ENDPOINTS.drive}/files`);
      const q = [`${literal(parent)} in parents`, 'trashed = false'];
      if (name) q.push(`name = ${literal(name)}`);
      const params: Record<string, string> = {
        q: q.join(' and '),
        driveId: this.settings.driveId,
        corpora: 'drive',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
        fields: 'nextPageToken,files(id,name,mimeType)',
        pageSize: '1000',
        ...(pageToken ? { pageToken } : {}),
      };
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const response = await sinkFetch(
        { label, url: url.href, init: { headers: await this.auth() } },
        this.http,
      );
      const body = await jsonOf<{ files?: DriveFile[]; nextPageToken?: string }>(response, label);
      files.push(...(body.files ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return files;
  }

  private async createFolder(parent: string, name: string, label: string): Promise<string> {
    const response = await sinkFetch(
      {
        label,
        url: `${GDRIVE_ENDPOINTS.drive}/files?supportsAllDrives=true&fields=id`,
        init: {
          method: 'POST',
          headers: { ...(await this.auth()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
        },
        retry: false,
      },
      this.http,
    );
    const body = await jsonOf<{ id?: string }>(response, label);
    if (!body.id) throw new Error(`${label}: no folder in the response`);
    return body.id;
  }

  /** The folder of `dir` (`yyyy-mm` or `yyyy-mm/revisions`); created when `create`. */
  private async folder(dir: string, create: boolean): Promise<string | null> {
    const cached = this.folders.get(dir);
    if (cached) return cached;
    let parent = this.settings.folderId;
    let walked = '';
    for (const segment of dir.split('/')) {
      walked = walked ? `${walked}/${segment}` : segment;
      const label = `gdrive: folder ${walked}`;
      const found =
        this.folders.get(walked) ??
        (await this.children(parent, label, segment)).find((f) => f.mimeType === FOLDER)?.id;
      const id = found ?? (create ? await this.createFolder(parent, segment, label) : null);
      if (!id) return null;
      this.folders.set(walked, id);
      parent = id;
    }
    return parent;
  }

  private async fileOf(path: string, create: boolean) {
    const at = path.lastIndexOf('/');
    const dir = path.slice(0, at);
    const name = path.slice(at + 1);
    const folder = await this.folder(dir, create);
    if (!folder) return { folder, name, file: undefined };
    const files = await this.children(folder, `gdrive: lookup of ${path}`, name);
    return { folder, name, file: files.find((f) => f.mimeType !== FOLDER) };
  }

  /** Opens a resumable session (create or update) and resolves its session URI. */
  private async session(path: string, bytes: Uint8Array): Promise<string> {
    const { folder, name, file } = await this.fileOf(path, true);
    const label = `gdrive: upload of ${path}`;
    const url = file
      ? `${GDRIVE_ENDPOINTS.upload}/files/${encodeURIComponent(file.id)}?uploadType=resumable&supportsAllDrives=true`
      : `${GDRIVE_ENDPOINTS.upload}/files?uploadType=resumable&supportsAllDrives=true`;
    const response = await sinkFetch(
      {
        label,
        url,
        init: {
          method: file ? 'PATCH' : 'POST',
          headers: {
            ...(await this.auth()),
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': 'application/octet-stream',
            'X-Upload-Content-Length': String(bytes.byteLength),
          },
          body: JSON.stringify(file ? {} : { name, parents: [folder] }),
        },
      },
      this.http,
    );
    const location = response.headers.get('location');
    if (!location) throw new Error(`${label}: no upload session`);
    return location;
  }

  async put(path: string, bytes: Uint8Array): Promise<void> {
    assertSinkPath(path);
    const location = await this.session(path, bytes);
    // A failed session is not repeated as is: the push starts a new one (whole-file attempts).
    await sinkFetch(
      {
        label: `gdrive: upload of ${path}`,
        url: location,
        init: {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bodyOf(bytes),
        },
        retry: false,
      },
      this.http,
    );
  }

  async get(path: string): Promise<Uint8Array | null> {
    assertSinkPath(path);
    const { file } = await this.fileOf(path, false);
    if (!file) return null;
    const response = await sinkFetch(
      {
        label: `gdrive: download of ${path}`,
        url: `${GDRIVE_ENDPOINTS.drive}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,
        init: { headers: await this.auth() },
      },
      this.http,
    );
    return bytesOf(response);
  }

  async list(prefix: string): Promise<string[]> {
    if (!LEDGER_MONTH.test(prefix)) throw new Error(`Invalid ledger sink month: ${prefix}`);
    const paths: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const folder = await this.folder(dir, false);
      if (!folder) return;
      for (const entry of await this.children(folder, `gdrive: listing of ${dir}`)) {
        if (entry.mimeType !== FOLDER) paths.push(`${dir}/${entry.name}`);
        else if (!dir.includes('/')) await walk(`${dir}/${entry.name}`);
      }
    };
    await walk(prefix);
    return paths.sort();
  }
}
