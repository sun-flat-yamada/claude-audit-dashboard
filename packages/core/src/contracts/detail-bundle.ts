import type { z } from 'zod';
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

function countOf(entry: DetailManifestFile, data: Json): number {
  if (entry.kind === 'members') return rows(data, 'members').length;
  if (entry.kind === 'api-keys') return rows(data, 'keys').length;
  if (entry.kind === 'activity') return rows(data, 'items').length;
  return rows(data, 'groups').length;
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
      .filter((p) => p !== DETAIL_MANIFEST_PATH && !listed.has(p))
      .map((p) => `${p}: not listed in the manifest`),
    ...listedErrors(manifest, files),
  ];
}
