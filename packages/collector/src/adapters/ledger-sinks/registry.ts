import { Registry, type LedgerSink } from '@claude-audit/core';
import { FilesystemLedgerSink, filesystemSinkRoot } from './filesystem.js';
import { GdriveLedgerSink } from './gdrive.js';
import type { SinkHttpOptions } from './http.js';
import { requireVariables, type OidcSettings } from './oidc.js';
import { SharepointLedgerSink, sharepointFolder } from './sharepoint.js';

/** What a sink may read: the variables (`LEDGER_*`, the Actions OIDC request), paths, HTTP. */
export interface LedgerSinkContext {
  /** Non-blank `LEDGER_*` variables (not `LEDGER_PIPELINE_KEY`) and `ACTIONS_ID_TOKEN_REQUEST_*`. */
  variables: Readonly<Record<string, string | undefined>>;
  baseDir: string;
  dataDir: string;
  http: SinkHttpOptions;
}

/** One kind of external storage for sealed months (#161 U7); `ledger.sink` names it. */
export interface LedgerSinkDefinition {
  readonly kind: string;
  /** Variables the kind reads (documented in `.env.example` and `docs/SETUP.md`). */
  readonly variables: readonly string[];
  create(context: LedgerSinkContext): LedgerSink;
}

/** The value of `ledger.sink` that turns copying off (the default). */
export const NO_LEDGER_SINK = 'none';

const oidcOf = (v: LedgerSinkContext['variables']): OidcSettings => ({
  requestUrl: v.ACTIONS_ID_TOKEN_REQUEST_URL,
  requestToken: v.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
});

export const filesystemSinkDefinition: LedgerSinkDefinition = {
  kind: 'filesystem',
  variables: ['LEDGER_SINK_DIR'],
  create: (c) => {
    const v = requireVariables('filesystem', c.variables, ['LEDGER_SINK_DIR']);
    return new FilesystemLedgerSink(filesystemSinkRoot(v.LEDGER_SINK_DIR, c.baseDir, c.dataDir));
  },
};

const GDRIVE_VARIABLES = [
  'LEDGER_GDRIVE_WORKLOAD_IDENTITY_PROVIDER',
  'LEDGER_GDRIVE_SERVICE_ACCOUNT',
  'LEDGER_GDRIVE_DRIVE_ID',
  'LEDGER_GDRIVE_FOLDER_ID',
] as const;

export const gdriveSinkDefinition: LedgerSinkDefinition = {
  kind: 'gdrive',
  variables: GDRIVE_VARIABLES,
  create: (c) => {
    const v = requireVariables('gdrive', c.variables, GDRIVE_VARIABLES);
    return new GdriveLedgerSink(
      {
        workloadIdentityProvider: v.LEDGER_GDRIVE_WORKLOAD_IDENTITY_PROVIDER,
        serviceAccount: v.LEDGER_GDRIVE_SERVICE_ACCOUNT,
        driveId: v.LEDGER_GDRIVE_DRIVE_ID,
        folderId: v.LEDGER_GDRIVE_FOLDER_ID,
      },
      oidcOf(c.variables),
      c.http,
    );
  },
};

const SHAREPOINT_VARIABLES = [
  'LEDGER_SHAREPOINT_TENANT_ID',
  'LEDGER_SHAREPOINT_CLIENT_ID',
  'LEDGER_SHAREPOINT_DRIVE_ID',
] as const;

export const DEFAULT_SHAREPOINT_FOLDER = 'claude-audit-ledger';

export const sharepointSinkDefinition: LedgerSinkDefinition = {
  kind: 'sharepoint',
  variables: [...SHAREPOINT_VARIABLES, 'LEDGER_SHAREPOINT_FOLDER'],
  create: (c) => {
    const v = requireVariables('sharepoint', c.variables, SHAREPOINT_VARIABLES);
    return new SharepointLedgerSink(
      {
        tenantId: v.LEDGER_SHAREPOINT_TENANT_ID,
        clientId: v.LEDGER_SHAREPOINT_CLIENT_ID,
        driveId: v.LEDGER_SHAREPOINT_DRIVE_ID,
        folder: sharepointFolder(c.variables.LEDGER_SHAREPOINT_FOLDER ?? DEFAULT_SHAREPOINT_FOLDER),
      },
      oidcOf(c.variables),
      c.http,
    );
  },
};

/** The built-in kinds. A new one is one adapter plus one entry here. */
export const LEDGER_SINKS = new Registry<LedgerSinkDefinition>((d) => d.kind, 'ledger sink').addAll(
  [filesystemSinkDefinition, gdriveSinkDefinition, sharepointSinkDefinition],
);

/** The sink `ledger.sink` names; null for `none`. Unknown kinds and missing variables throw. */
export function createLedgerSink(kind: string, context: LedgerSinkContext): LedgerSink | null {
  if (kind === NO_LEDGER_SINK) return null;
  return LEDGER_SINKS.require(kind).create(context);
}
