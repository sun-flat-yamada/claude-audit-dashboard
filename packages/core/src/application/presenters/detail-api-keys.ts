import type { DetailApiKeys } from '../../contracts/detail-view.js';
import { DETAIL_SCHEMA_VERSION } from '../../contracts/detail-view.js';
import type { DatasetMap, TimeWindow } from '../../domain/model/dataset.js';
import type { IdentityMasker } from '../../domain/util/mask.js';

export interface DetailApiKeysInput {
  now: Date;
  data: DatasetMap;
  usageWindow: TimeWindow | null;
  unusedDays: number;
  maxAgeDays: number;
  mask: IdentityMasker;
}

/** `createdBy` is an e-mail address or a user id depending on the API; both are masked. */
const creator = (mask: IdentityMasker, value: string | null): string | null => {
  if (value === null) return null;
  return value.includes('@') ? mask.email(value) : mask.id('u', value);
};

/** Key inventory. Only identifiers and metadata the API returns; never key material. */
export function buildDetailApiKeys(input: DetailApiKeysInput): DetailApiKeys {
  const { data, mask } = input;
  const lastSeen = new Map(data.credentialUsage.map((u) => [u.credentialId, u.lastSeenAt]));
  return {
    schemaVersion: DETAIL_SCHEMA_VERSION,
    generatedAt: input.now.toISOString(),
    unusedDays: input.unusedDays,
    maxAgeDays: input.maxAgeDays,
    usageObservedFrom: input.usageWindow?.from ?? null,
    keys: data.credentials.map((k) => ({
      id: mask.id('k', k.id),
      name: k.name,
      scopes: k.scopes,
      active: k.active,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
      createdBy: creator(mask, k.createdBy),
      lastSeenAt: lastSeen.get(k.id) ?? null,
    })),
  };
}
