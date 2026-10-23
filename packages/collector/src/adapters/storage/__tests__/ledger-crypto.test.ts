import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  decryptEnvelope,
  encryptEnvelope,
  encryptedLedgerCodec,
  envelopeReaders,
  formatRecipient,
  generateIdentity,
  generatePipelineKey,
  isEncryptedEnvelope,
  parseIdentity,
  parseIdentityFile,
  parsePipelineKey,
  parseRecipient,
  type LedgerKeyring,
} from '../ledger-crypto.js';
import { ledgerCodecsFor } from '../ledger.js';

// Keys are generated at run time: no key material is written into the repository.
const alice = generateIdentity();
const bob = generateIdentity();
const pipelineText = generatePipelineKey();
const pipeline = parsePipelineKey(pipelineText);

const keyring = (over: Partial<LedgerKeyring> = {}): LedgerKeyring => ({
  recipients: [],
  identities: [],
  pipeline: null,
  ...over,
});

const PLAIN = Buffer.from('{"key":"user_alice@example.com","item":{"ip":"192.0.2.1"}}\n');

describe('ledger envelope encryption (#162 U8)', () => {
  it('round-trips for a recipient and never stores the plaintext', () => {
    const sealed = encryptEnvelope(
      PLAIN,
      keyring({ recipients: [parseRecipient(alice.recipient)] }),
    );
    expect(isEncryptedEnvelope(sealed)).toBe(true);
    expect(sealed.includes(Buffer.from('example.com'))).toBe(false);
    expect(sealed.includes(Buffer.from('192.0.2.1'))).toBe(false);
    const opened = decryptEnvelope(
      sealed,
      keyring({ identities: [parseIdentity(alice.identity)] }),
    );
    expect(opened.equals(PLAIN)).toBe(true);
  });

  it('lets every one of several recipients and the pipeline key decrypt on its own', () => {
    const sealed = encryptEnvelope(
      PLAIN,
      keyring({ recipients: [alice, bob].map((k) => parseRecipient(k.recipient)), pipeline }),
    );
    expect(envelopeReaders(sealed)).toHaveLength(3);
    for (const identity of [alice, bob])
      expect(
        decryptEnvelope(sealed, keyring({ identities: [parseIdentity(identity.identity)] })).equals(
          PLAIN,
        ),
      ).toBe(true);
    expect(decryptEnvelope(sealed, keyring({ pipeline })).equals(PLAIN)).toBe(true);
  });

  it('refuses a key the file was not encrypted for (key mismatch)', () => {
    const sealed = encryptEnvelope(
      PLAIN,
      keyring({ recipients: [parseRecipient(alice.recipient)] }),
    );
    expect(() =>
      decryptEnvelope(sealed, keyring({ identities: [parseIdentity(bob.identity)] })),
    ).toThrow(/no matching key \(encrypted for x25519:[0-9a-f]{16}\)/);
    expect(() =>
      decryptEnvelope(sealed, keyring({ pipeline: parsePipelineKey(generatePipelineKey()) })),
    ).toThrow(/no matching key/);
    expect(() => decryptEnvelope(sealed, keyring())).toThrow(/no matching key/);
  });

  it('refuses a stanza with a forged fingerprint but another key', () => {
    const other = parsePipelineKey(generatePipelineKey());
    const sealed = encryptEnvelope(PLAIN, keyring({ pipeline: other }));
    const forged = { ...pipeline, fingerprint: other.fingerprint };
    expect(() => decryptEnvelope(sealed, keyring({ pipeline: forged }))).toThrow(/no matching key/);
  });

  it('detects a changed ciphertext or header', () => {
    const keys = keyring({ pipeline });
    const sealed = encryptEnvelope(PLAIN, keys);
    const body = Buffer.from(sealed);
    body[body.length - 20] = (body[body.length - 20] ?? 0) ^ 1;
    expect(() => decryptEnvelope(body, keys)).toThrow(/failed authentication/);
    const header = Buffer.from(sealed);
    const at = header.indexOf(Buffer.from('"alg"'));
    header[at + 1] = 'b'.charCodeAt(0);
    expect(() => decryptEnvelope(header, keys)).toThrow(/failed authentication/);
    expect(() => decryptEnvelope(sealed.subarray(0, 10), keys)).toThrow(/encrypted ledger file/);
  });

  it('encrypts each file with a fresh key and IV', () => {
    const keys = keyring({ pipeline });
    expect(encryptEnvelope(PLAIN, keys).equals(encryptEnvelope(PLAIN, keys))).toBe(false);
  });

  it('rejects malformed keys without quoting them', () => {
    const bad = `${alice.identity}x`;
    expect(() => parseIdentity(bad)).toThrow(/Invalid ledger identity/);
    expect(() => parseIdentity(bad)).not.toThrow(bad);
    expect(() => parseRecipient(alice.identity)).toThrow(/Invalid ledger recipient public key/);
    expect(() => parsePipelineKey(alice.identity)).toThrow(/Invalid LEDGER_PIPELINE_KEY/);
    expect(() => encryptEnvelope(PLAIN, keyring())).toThrow(/at least one recipient/);
  });

  it('derives the public key from an identity file', () => {
    const identity = parseIdentityFile(`# comment\n\n${alice.identity}\n`);
    expect(formatRecipient(identity.recipient)).toBe(alice.recipient);
  });

  it('codec: gzip inside the envelope, decoded back to the text', () => {
    const codec = encryptedLedgerCodec(keyring({ pipeline }));
    const bytes = codec.encode('line\n');
    expect(() => gunzipSync(bytes)).toThrow();
    expect(codec.decode(bytes)).toBe('line\n');
  });
});

describe('ledgerCodecsFor', () => {
  it('stays plain by default', () => {
    const codecs = ledgerCodecsFor({ recipients: [], pipelineKey: undefined });
    expect(codecs.write.suffix).toBe('.jsonl.gz');
    expect(codecs.read).toEqual([]);
  });

  it('writes encrypted with recipients and the pipeline key, reads plain files too', () => {
    const codecs = ledgerCodecsFor({ recipients: [alice.recipient], pipelineKey: pipelineText });
    expect(codecs.write).toMatchObject({ suffix: '.jsonl.gz.enc', encrypted: true });
    expect(codecs.read.map((c) => c.suffix)).toEqual(['.jsonl.gz']);
  });

  it('fails closed with recipients but no pipeline key', () => {
    expect(() =>
      ledgerCodecsFor({ recipients: [alice.recipient], pipelineKey: undefined }),
    ).toThrow(/LEDGER_PIPELINE_KEY is not/);
  });

  it('names the bad recipient by index only', () => {
    expect(() =>
      ledgerCodecsFor({ recipients: [alice.recipient, 'nope'], pipelineKey: pipelineText }),
    ).toThrow('Invalid ledger.encryption.recipients[1] (value not shown)');
  });

  it('keeps writing plain but reads encrypted files with only the pipeline key', () => {
    const codecs = ledgerCodecsFor({ recipients: [], pipelineKey: pipelineText });
    expect(codecs.write.suffix).toBe('.jsonl.gz');
    expect(codecs.read.map((c) => c.suffix)).toEqual(['.jsonl.gz.enc']);
  });
});
