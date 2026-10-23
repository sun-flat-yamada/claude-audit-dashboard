import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * Optional encryption of the ledger files at rest (#162 U8), with Node's built-in crypto only.
 *
 * Envelope encryption in the spirit of age: every file gets a fresh random file key; the gzip
 * bytes are encrypted with AES-256-GCM (the header is authenticated as additional data). The file
 * key is wrapped once per reader in a header stanza: one `x25519` stanza per recipient public key
 * (ephemeral ECDH + HKDF-SHA256 + AES-256-GCM) and one `pipeline` stanza for the symmetric key the
 * workflows use to read back what they wrote. Recipient private keys never reach the workflows.
 *
 * No message of this module contains key material or file content.
 */

/** File name suffix of an encrypted ledger file (gzip, then the envelope). */
export const ENCRYPTED_LEDGER_SUFFIX = '.jsonl.gz.enc';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAGIC = Buffer.from('CADLENC1', 'ascii');
const VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const HKDF_INFO = {
  x25519: 'claude-audit ledger v1 x25519',
  pipeline: 'claude-audit ledger v1 pipeline',
} as const;

/** Text forms of the keys: 32 raw bytes, base64url (43 characters). */
export const PUBLIC_KEY_PREFIX = 'cadl-pub-';
export const IDENTITY_PREFIX = 'CADL-SECRET-';
export const PIPELINE_KEY_PREFIX = 'CADL-PIPELINE-';
const KEY_TEXT = /^[A-Za-z0-9_-]{43}$/;

/** DER prefixes that turn a raw 32-byte X25519 key into SPKI / PKCS#8 (RFC 8410). */
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

export interface LedgerRecipient {
  readonly publicKey: KeyObject;
  readonly raw: Buffer;
  readonly fingerprint: string;
}

/** A recipient's private key (local only: `pnpm ledger decrypt`). */
export interface LedgerIdentity {
  readonly privateKey: KeyObject;
  readonly recipient: LedgerRecipient;
}

/** The symmetric key of the workflows (`LEDGER_PIPELINE_KEY`). */
export interface LedgerPipelineKey {
  readonly key: Buffer;
  readonly fingerprint: string;
}

/** Who can write (recipients + pipeline key) and who can read (identities + pipeline key). */
export interface LedgerKeyring {
  readonly recipients: readonly LedgerRecipient[];
  readonly identities: readonly LedgerIdentity[];
  readonly pipeline: LedgerPipelineKey | null;
}

const fingerprintOf = (label: string, raw: Buffer): string =>
  createHash('sha256').update(label).update(raw).digest('hex').slice(0, 16);

function rawKey(text: string, prefix: string, what: string): Buffer {
  const trimmed = text.trim();
  const body = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : null;
  if (body === null || !KEY_TEXT.test(body))
    throw new Error(
      `Invalid ${what}: expected ${prefix}<43 base64url characters> (value not shown)`,
    );
  return Buffer.from(body, 'base64url');
}

function recipientOfRaw(raw: Buffer): LedgerRecipient {
  const publicKey = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
  return { publicKey, raw, fingerprint: fingerprintOf('x25519', raw) };
}

const rawPublicOf = (key: KeyObject): Buffer =>
  key.export({ format: 'der', type: 'spki' }).subarray(SPKI_PREFIX.length);

export const parseRecipient = (text: string): LedgerRecipient =>
  recipientOfRaw(rawKey(text, PUBLIC_KEY_PREFIX, 'ledger recipient public key'));

export function parseIdentity(text: string): LedgerIdentity {
  const raw = rawKey(text, IDENTITY_PREFIX, 'ledger identity');
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  });
  return { privateKey, recipient: recipientOfRaw(rawPublicOf(createPublicKey(privateKey))) };
}

/** The first line of an identity file that is not blank and not a `#` comment. */
export function parseIdentityFile(content: string): LedgerIdentity {
  const line = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('#'));
  return parseIdentity(line ?? '');
}

export function parsePipelineKey(text: string): LedgerPipelineKey {
  const key = rawKey(text, PIPELINE_KEY_PREFIX, 'LEDGER_PIPELINE_KEY');
  return { key, fingerprint: fingerprintOf('pipeline', key) };
}

export const formatRecipient = (recipient: LedgerRecipient): string =>
  `${PUBLIC_KEY_PREFIX}${recipient.raw.toString('base64url')}`;

/** A new recipient key pair as text: the private identity and its public key. */
export function generateIdentity(): { identity: string; recipient: string } {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const raw = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(PKCS8_PREFIX.length);
  return {
    identity: `${IDENTITY_PREFIX}${raw.toString('base64url')}`,
    recipient: `${PUBLIC_KEY_PREFIX}${rawPublicOf(publicKey).toString('base64url')}`,
  };
}

export const generatePipelineKey = (): string =>
  `${PIPELINE_KEY_PREFIX}${randomBytes(KEY_BYTES).toString('base64url')}`;

interface Stanza {
  type: string;
  /** Fingerprint of the recipient or pipeline key (not secret). */
  id: string;
  iv: string;
  /** Wrapped file key + GCM tag. */
  key: string;
  /** `x25519`: the ephemeral public key. */
  epk?: string;
}

interface Header {
  v: number;
  alg: 'A256GCM';
  iv: string;
  stanzas: Stanza[];
}

function seal(key: Buffer, iv: Buffer, plain: Buffer, aad?: Buffer): Buffer {
  const cipher = createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

/** Throws (GCM authentication) when the key is wrong or the bytes were changed. */
function open(key: Buffer, iv: Buffer, sealed: Buffer, aad?: Buffer): Buffer {
  if (sealed.length < TAG_BYTES) throw new Error('truncated');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
    decipher.final(),
  ]);
}

const hkdf = (secret: Buffer, salt: Buffer, info: string): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, salt, info, KEY_BYTES));

function wrapForRecipient(fileKey: Buffer, recipient: LedgerRecipient): Stanza {
  const ephemeral = generateKeyPairSync('x25519');
  const epk = rawPublicOf(ephemeral.publicKey);
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: recipient.publicKey,
  });
  const wrapKey = hkdf(shared, Buffer.concat([epk, recipient.raw]), HKDF_INFO.x25519);
  const iv = randomBytes(IV_BYTES);
  return {
    type: 'x25519',
    id: recipient.fingerprint,
    epk: epk.toString('base64url'),
    iv: iv.toString('base64url'),
    key: seal(wrapKey, iv, fileKey).toString('base64url'),
  };
}

function wrapForPipeline(fileKey: Buffer, pipeline: LedgerPipelineKey): Stanza {
  const iv = randomBytes(IV_BYTES);
  return {
    type: 'pipeline',
    id: pipeline.fingerprint,
    iv: iv.toString('base64url'),
    key: seal(hkdf(pipeline.key, iv, HKDF_INFO.pipeline), iv, fileKey).toString('base64url'),
  };
}

const b64 = (value: string | undefined): Buffer => Buffer.from(value ?? '', 'base64url');

/** How each stanza type unwraps the file key with the keys at hand (registry, no switch). */
const UNWRAP: Readonly<Record<string, (stanza: Stanza, keys: LedgerKeyring) => Buffer | null>> = {
  x25519(stanza, keys) {
    const identity = keys.identities.find((i) => i.recipient.fingerprint === stanza.id);
    if (!identity) return null;
    const epk = b64(stanza.epk);
    const shared = diffieHellman({
      privateKey: identity.privateKey,
      publicKey: recipientOfRaw(epk).publicKey,
    });
    const wrapKey = hkdf(shared, Buffer.concat([epk, identity.recipient.raw]), HKDF_INFO.x25519);
    return open(wrapKey, b64(stanza.iv), b64(stanza.key));
  },
  pipeline(stanza, keys) {
    if (!keys.pipeline || keys.pipeline.fingerprint !== stanza.id) return null;
    const iv = b64(stanza.iv);
    return open(hkdf(keys.pipeline.key, iv, HKDF_INFO.pipeline), iv, b64(stanza.key));
  },
};

/** Encrypts `plain` for every recipient and the pipeline key of `keys`. */
export function encryptEnvelope(plain: Uint8Array, keys: LedgerKeyring): Buffer {
  if (keys.recipients.length === 0 && !keys.pipeline)
    throw new Error('Ledger encryption needs at least one recipient or the pipeline key');
  const fileKey = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const stanzas = keys.recipients.map((r) => wrapForRecipient(fileKey, r));
  if (keys.pipeline) stanzas.push(wrapForPipeline(fileKey, keys.pipeline));
  const header: Header = { v: VERSION, alg: 'A256GCM', iv: iv.toString('base64url'), stanzas };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(headerBytes.length);
  const prefix = Buffer.concat([MAGIC, length, headerBytes]);
  return Buffer.concat([prefix, seal(fileKey, iv, Buffer.from(plain), prefix)]);
}

export const isEncryptedEnvelope = (bytes: Uint8Array): boolean =>
  bytes.length >= MAGIC.length && Buffer.from(bytes.subarray(0, MAGIC.length)).equals(MAGIC);

function readHeader(bytes: Buffer): { header: Header; prefix: Buffer } {
  if (!isEncryptedEnvelope(bytes) || bytes.length < MAGIC.length + 4)
    throw new Error('not an encrypted ledger file');
  const end = MAGIC.length + 4 + bytes.readUInt32BE(MAGIC.length);
  if (end > bytes.length) throw new Error('truncated encrypted ledger file');
  const header = JSON.parse(bytes.subarray(MAGIC.length + 4, end).toString('utf8')) as Header;
  if (header.v !== VERSION || !Array.isArray(header.stanzas))
    throw new Error(`unsupported encrypted ledger file version ${String(header.v)}`);
  return { header, prefix: bytes.subarray(0, end) };
}

/** The file key from the first stanza a key at hand opens; a wrong key fails GCM and is skipped. */
function unwrapFileKey(header: Header, keys: LedgerKeyring): Buffer | null {
  for (const stanza of header.stanzas) {
    try {
      const key = UNWRAP[stanza.type]?.(stanza, keys) ?? null;
      if (key) return key;
    } catch {
      // Not this key: try the next stanza.
    }
  }
  return null;
}

/** Fingerprints the file was encrypted for (no key material). */
export const envelopeReaders = (bytes: Uint8Array): string[] =>
  readHeader(Buffer.from(bytes)).header.stanzas.map((s) => `${s.type}:${s.id}`);

/** Decrypts an envelope; throws when no key at hand matches or the file was changed. */
export function decryptEnvelope(bytes: Uint8Array, keys: LedgerKeyring): Buffer {
  const buffer = Buffer.from(bytes);
  const { header, prefix } = readHeader(buffer);
  const fileKey = unwrapFileKey(header, keys);
  if (!fileKey)
    throw new Error(
      `no matching key (encrypted for ${header.stanzas.map((s) => `${s.type}:${s.id}`).join(', ')})`,
    );
  try {
    return open(fileKey, b64(header.iv), buffer.subarray(prefix.length), prefix);
  } catch {
    throw new Error('encrypted ledger file failed authentication (changed or damaged)');
  }
}

/** A codec shape compatible with `LedgerCodec` (`ledger.ts`): gzip, then the envelope. */
export function encryptedLedgerCodec(keys: LedgerKeyring) {
  return {
    suffix: ENCRYPTED_LEDGER_SUFFIX,
    encrypted: true,
    encode: (text: string): Uint8Array => encryptEnvelope(gzipSync(text, { level: 9 }), keys),
    decode: (bytes: Uint8Array): string =>
      gunzipSync(decryptEnvelope(bytes, keys)).toString('utf8'),
  };
}
