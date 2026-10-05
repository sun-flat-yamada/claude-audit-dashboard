import type { z } from 'zod';
import { detailAlertsSchema } from './alerts-view.js';
import { detailArchiveSchema } from './archive-view.js';
import { detailConfigSchema, looksSensitive } from './config-view.js';
import {
  DETAIL_MANIFEST_PATH,
  detailActivitySchema,
  detailApiKeysSchema,
  detailManifestSchema,
  detailMembersSchema,
  detailOrgGroupsSchema,
  type DetailManifest,
  type DetailManifestFile,
} from './detail-view.js';
import {
  MONTHLY_DIR,
  MONTHLY_INDEX_PATH,
  monthlyReportIndexSchema,
  monthlyReportSchema,
} from './monthly-report.js';

/** Contents of a `detail/` directory keyed by path relative to the data directory. */
export type DetailBundleFiles = Readonly<Record<string, string>>;

export interface DetailBundleOptions {
  /** Published samples must come from the synthetic tenant. */
  requireDemo?: boolean;
}

const EMAIL = /[A-Za-z0-9._%+*-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;
const SAFE_EMAIL = /@(?:[A-Za-z0-9-]+\.)*example\.(?:com|org|net)$/i;
const HASHED_ID = /^(?:u|k|i|a)_[0-9a-f]{12}$/;
const MASKED_WORD = /^.\*{3}$/u;

const SCHEMAS = {
  members: detailMembersSchema,
  'api-keys': detailApiKeysSchema,
  activity: detailActivitySchema,
  'org-groups': detailOrgGroupsSchema,
  config: detailConfigSchema,
  archive: detailArchiveSchema,
  alerts: detailAlertsSchema,
} as const;

type Json = Record<string, unknown>;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** E-mail addresses must be example.* and, when masking is on, actually masked. */
function emailErrors(path: string, text: string, maskPii: boolean): string[] {
  const found = [...new Set(text.match(EMAIL) ?? [])];
  return found.flatMap((email) => {
    if (!SAFE_EMAIL.test(email)) return [`${path}: non-example.com e-mail address ${email}`];
    if (maskPii && !email.split('@')[0]?.includes('***'))
      return [`${path}: unmasked e-mail address ${email}`];
    return [];
  });
}

const idError = (path: string, label: string, value: unknown): string[] =>
  typeof value === 'string' && HASHED_ID.test(value)
    ? []
    : [`${path}: unmasked ${label} ${String(value)}`];

const rows = (data: Json, key: string): Json[] =>
  Array.isArray(data[key]) ? (data[key] as Json[]) : [];

function memberMaskErrors(path: string, data: Json): string[] {
  const names = rows(data, 'members').flatMap((m) =>
    String(m.name)
      .split(' ')
      .every((w) => MASKED_WORD.test(w))
      ? []
      : [`${path}: unmasked member name`],
  );
  return [
    ...rows(data, 'members').flatMap((m) => idError(path, 'user id', m.id)),
    ...rows(data, 'invites').flatMap((i) => idError(path, 'invite id', i.id)),
    ...names,
  ];
}

function keyMaskErrors(path: string, data: Json): string[] {
  return rows(data, 'keys').flatMap((k) => [
    ...idError(path, 'key id', k.id),
    ...(k.createdBy === null || String(k.createdBy).includes('@')
      ? []
      : idError(path, 'creator id', k.createdBy)),
  ]);
}

function activityMaskErrors(path: string, data: Json): string[] {
  return rows(data, 'items').flatMap((item) => {
    const actor = (item.actor ?? {}) as Json;
    return [
      ...(actor.id === null ? [] : idError(path, 'actor id', actor.id)),
      ...(actor.ip === null ? [] : [`${path}: unmasked IP address`]),
    ];
  });
}

function maskErrors(entry: DetailManifestFile, path: string, data: Json): string[] {
  if (entry.kind === 'members') return memberMaskErrors(path, data);
  if (entry.kind === 'api-keys') return keyMaskErrors(path, data);
  if (entry.kind === 'activity') return activityMaskErrors(path, data);
  return [];
}

const stringsIn = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringsIn);
  return [];
};

/** The effective configuration and the alert history carry no secrets, URLs, addresses or paths in any string. */
function configLeakErrors(path: string, data: Json): string[] {
  const hits = stringsIn(data).filter(looksSensitive);
  return hits.length === 0
    ? []
    : [`${path}: ${String(hits.length)} value(s) look like a secret, URL, e-mail address or path`];
}

/** Totals must equal the per-year rows, and each row's ids must belong to its year. */
function archiveErrors(path: string, data: Json): string[] {
  const years = rows(data, 'years');
  const totals = (data.totals ?? {}) as Json;
  const sum = (key: string): number => years.reduce((n, y) => n + Number(y[key]), 0);
  const stray = years.filter(
    (y) =>
      String(y.oldest).slice(0, 4) !== y.year ||
      String(y.newest).slice(0, 4) !== y.year ||
      String(y.oldest) > String(y.newest),
  );
  return [
    ...(totals.snapshots === sum('snapshots') && totals.bytes === sum('bytes')
      ? []
      : [`${path}: totals differ from the per-year rows`]),
    ...(totals.years === years.length ? [] : [`${path}: year total differs from the rows`]),
    ...(stray.length === 0 ? [] : [`${path}: snapshot ids outside their year`]),
  ];
}

/** Totals match the rows, acknowledgements come in pairs, ids are unique and all in rows. */
function alertsErrors(path: string, data: Json): string[] {
  const alerts = rows(data, 'alerts');
  const totals = (data.totals ?? {}) as Json;
  const acked = alerts.filter((a) => a.acknowledged === true).length;
  const halfAcked = alerts.filter(
    (a) => (a.acknowledged === true) !== (a.acknowledgedAt !== null && a.acknowledgedBy !== null),
  );
  const unmarked = alerts.filter(
    (a) => a.acknowledged !== true && (a.acknowledgedAt !== null || a.acknowledgedBy !== null),
  );
  return [
    ...(totals.alerts === alerts.length &&
    totals.acknowledged === acked &&
    totals.unacknowledged === alerts.length - acked
      ? []
      : [`${path}: totals differ from the alert rows`]),
    ...(halfAcked.length + unmarked.length === 0
      ? []
      : [`${path}: acknowledgement fields are inconsistent`]),
    ...(new Set(alerts.map((a) => a.id)).size === alerts.length
      ? []
      : [`${path}: duplicate alert ids`]),
  ];
}

function countOf(entry: DetailManifestFile, data: Json): number {
  if (entry.kind === 'alerts') return rows(data, 'alerts').length;
  if (entry.kind === 'archive') return Number((data.totals as Json | undefined)?.snapshots);
  if (entry.kind === 'config') return rows(data, 'rules').length;
  if (entry.kind === 'members') return rows(data, 'members').length;
  if (entry.kind === 'api-keys') return rows(data, 'keys').length;
  if (entry.kind === 'activity') return rows(data, 'items').length;
  return rows(data, 'groups').length;
}

/** Consistency rules that only apply to one kind of file. */
function kindErrors(entry: DetailManifestFile, data: Json): string[] {
  const path = entry.path;
  if (entry.kind === 'config') return configLeakErrors(path, data);
  if (entry.kind === 'alerts')
    return [...configLeakErrors(path, data), ...alertsErrors(path, data)];
  if (entry.kind === 'archive') return archiveErrors(path, data);
  return [];
}

function fileErrors(manifest: DetailManifest, entry: DetailManifestFile, text: string): string[] {
  const parsed = (SCHEMAS[entry.kind] as z.ZodType).safeParse(parseJson(text));
  if (!parsed.success) return [`${entry.path}: does not match the detail contract`];
  const data = parsed.data as Json;
  return [
    ...(countOf(entry, data) === entry.count
      ? []
      : [`${entry.path}: manifest count ${String(entry.count)} differs from the file`]),
    ...(entry.kind === 'activity' && data.month !== entry.month
      ? [`${entry.path}: month differs from the manifest`]
      : []),
    ...kindErrors(entry, data),
    ...emailErrors(entry.path, text, manifest.maskPii),
    ...(manifest.maskPii ? maskErrors(entry, entry.path, data) : []),
  ];
}

function listedErrors(manifest: DetailManifest, files: DetailBundleFiles): string[] {
  return manifest.files
    .filter((e) => e.status === 'ok')
    .flatMap((entry) => {
      const text = files[entry.path];
      return text === undefined
        ? [`${entry.path}: listed in the manifest but missing`]
        : fileErrors(manifest, entry, text);
    });
}

const isMonthly = (path: string): boolean => path.startsWith(`${MONTHLY_DIR}/`);

/** `detail/monthly/*`: index <-> files consistency, schemas, and example.* e-mails only. */
function monthlyErrors(files: DetailBundleFiles): string[] {
  const paths = Object.keys(files).filter(isMonthly);
  if (paths.length === 0) return [];
  const indexText = files[MONTHLY_INDEX_PATH];
  const index = monthlyReportIndexSchema.safeParse(
    indexText === undefined ? undefined : parseJson(indexText),
  );
  if (!index.success) return [`${MONTHLY_INDEX_PATH}: missing or does not match the contract`];
  const listed = new Set(index.data.reports.map((e) => e.path));
  const unlisted = paths
    .filter((p) => p !== MONTHLY_INDEX_PATH && !listed.has(p))
    .map((p) => `${p}: not listed in the monthly index`);
  const entries = index.data.reports.flatMap((entry) => {
    const text = files[entry.path];
    if (text === undefined) return [`${entry.path}: listed in the monthly index but missing`];
    const report = monthlyReportSchema.safeParse(parseJson(text));
    if (!report.success) return [`${entry.path}: does not match the monthly report contract`];
    return report.data.id === entry.id && report.data.month === entry.month
      ? emailErrors(entry.path, text, true)
      : [`${entry.path}: id or month differs from the monthly index`];
  });
  return [...unlisted, ...entries, ...emailErrors(MONTHLY_INDEX_PATH, indexText ?? '', true)];
}

/**
 * Validates a whole `detail/` directory (manifest, every listed file, nothing unlisted) and
 * returns human-readable problems; an empty list means the bundle is publishable as a sample.
 */
export function checkDetailBundle(
  files: DetailBundleFiles,
  options: DetailBundleOptions = {},
): string[] {
  const text = files[DETAIL_MANIFEST_PATH];
  if (text === undefined) return [`${DETAIL_MANIFEST_PATH}: missing`];
  const parsed = detailManifestSchema.safeParse(parseJson(text));
  if (!parsed.success) return [`${DETAIL_MANIFEST_PATH}: does not match the detail contract`];
  const manifest = parsed.data;
  const listed = new Set(manifest.files.map((e) => e.path));
  return [
    ...(options.requireDemo && manifest.source !== 'demo'
      ? [`${DETAIL_MANIFEST_PATH}: source must be demo`]
      : []),
    ...(options.requireDemo && !manifest.maskPii
      ? [`${DETAIL_MANIFEST_PATH}: maskPii must be true`]
      : []),
    ...Object.keys(files)
      .filter((p) => p !== DETAIL_MANIFEST_PATH && !listed.has(p) && !isMonthly(p))
      .map((p) => `${p}: not listed in the manifest`),
    ...listedErrors(manifest, files),
    ...monthlyErrors(files),
  ];
}
