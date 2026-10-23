import { jsonOf, sinkFetch, type SinkHttpOptions } from './http.js';

/**
 * The GitHub Actions OIDC token (#161 U7): no long-lived secret, the cloud side trusts the
 * repository's workflow. Present only in a job with `permissions: id-token: write`.
 */
export interface OidcSettings {
  /** `ACTIONS_ID_TOKEN_REQUEST_URL`. */
  requestUrl: string | undefined;
  /** `ACTIONS_ID_TOKEN_REQUEST_TOKEN` (a runtime credential: never logged). */
  requestToken: string | undefined;
}

export async function githubOidcToken(
  sink: string,
  settings: OidcSettings,
  audience: string,
  http: SinkHttpOptions,
): Promise<string> {
  const { requestUrl, requestToken } = settings;
  if (!requestUrl || !requestToken)
    throw new Error(
      `${sink} needs the GitHub Actions OIDC token: run it in a workflow job with permissions: id-token: write`,
    );
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    throw new Error(`${sink}: ACTIONS_ID_TOKEN_REQUEST_URL is not a URL (value not shown)`);
  }
  url.searchParams.set('audience', audience);
  const label = `${sink}: GitHub OIDC token request`;
  const response = await sinkFetch(
    { label, url: url.href, init: { headers: { Authorization: `Bearer ${requestToken}` } } },
    http,
  );
  const body = await jsonOf<{ value?: unknown }>(response, label);
  if (typeof body.value !== 'string' || body.value === '')
    throw new Error(`${label}: no token in the response`);
  return body.value;
}

/** An access token with its expiry; refreshed a minute before it ends. */
export interface AccessToken {
  token: string;
  expiresAt: number;
}

const MARGIN_MS = 60_000;

/** Caches one access token per sink for the run. */
export class TokenCache {
  private current: AccessToken | null = null;
  private pending: Promise<AccessToken> | null = null;

  constructor(
    private readonly fetchToken: () => Promise<AccessToken>,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<string> {
    if (this.current && this.current.expiresAt - MARGIN_MS > this.now()) return this.current.token;
    this.pending ??= this.fetchToken().finally(() => {
      this.pending = null;
    });
    this.current = await this.pending;
    return this.current.token;
  }
}

/** Throws a message that names the missing variables (names only, never values). */
export function requireVariables<K extends string>(
  sink: string,
  variables: Readonly<Record<string, string | undefined>>,
  names: readonly K[],
): Record<K, string> {
  const missing = names.filter((name) => !variables[name]);
  if (missing.length > 0)
    throw new Error(`ledger.sink ${sink} needs the variable(s) ${missing.join(', ')}`);
  return Object.fromEntries(names.map((name) => [name, variables[name]])) as Record<K, string>;
}
