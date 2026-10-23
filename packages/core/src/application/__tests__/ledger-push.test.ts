import { describe, expect, it } from 'vitest';
import { fnv } from '../../domain/__tests__/ledger-fixtures.js';
import {
  buildLedgerManifest,
  ledgerManifestSchema,
  type LedgerManifest,
} from '../../domain/ledger/manifest.js';
import { assertSinkPath, transferManifestOf } from '../../domain/ledger/transfer.js';
import { ledgerPushAlert } from '../ledger-alert.js';
import type { LedgerFileAccess, LedgerSink, StoredLedgerFile } from '../ports.js';
import { pushLedgerMonth, type LedgerPushDeps } from '../use-cases/ledger-push.js';

const MONTH = '2026-09';
const NOW = new Date('2026-10-10T05:00:00.000Z');
const enc = new TextEncoder();
const dec = new TextDecoder();

/** "Plain" files are the text itself; ".enc" files are the reversed text (opaque to the push). */
class FakeLedger implements LedgerFileAccess {
  readonly texts = new Map<string, string>();
  manifestValue: LedgerManifest | null = null;

  constructor(texts: Record<string, string>, encrypted = false) {
    for (const [dataset, text] of Object.entries(texts)) this.texts.set(dataset, text);
    const files = Object.entries(texts).map(([dataset, text]) => ({
      dataset,
      entries: [],
      sha256: fnv(text),
      encryptedSha256: encrypted ? fnv([...text].reverse().join('')) : undefined,
    }));
    this.manifestValue = { ...buildLedgerManifest(MONTH, files, true) };
    this.encrypted = encrypted;
  }

  readonly encrypted: boolean;

  manifest = async () => this.manifestValue;

  storedFiles = async (): Promise<StoredLedgerFile[]> =>
    [...this.texts].map(([dataset, text]) => ({
      name: `${dataset}.jsonl.gz${this.encrypted ? '.enc' : ''}`,
      dataset,
      revision: false,
      bytes: enc.encode(this.encrypted ? [...text].reverse().join('') : text),
    }));

  manifestFile = (manifest: LedgerManifest): StoredLedgerFile => ({
    name: 'MANIFEST.json',
    revision: false,
    bytes: enc.encode(JSON.stringify(manifest)),
  });

  digest = (name: string, bytes: Uint8Array) => ({
    stored: fnv(dec.decode(bytes)),
    content: name.endsWith('.enc') ? undefined : fnv(dec.decode(bytes)),
  });

  recordTransfer = async (
    _month: string,
    kind: string,
    record: { transferredAt: string; files: number },
  ) => {
    const m = this.manifestValue;
    if (m) this.manifestValue = { ...m, transfers: { ...m.transfers, [kind]: record } };
  };
}

class MemorySink implements LedgerSink {
  readonly kind = 'memory';
  readonly files = new Map<string, Uint8Array>();
  puts = 0;
  /** Corrupts the next N uploads (stored bytes differ). */
  corrupt = 0;
  /** Fails the next N uploads with an error. */
  fail = 0;

  async put(path: string, bytes: Uint8Array) {
    assertSinkPath(path);
    this.puts += 1;
    if (this.fail > 0) {
      this.fail -= 1;
      throw new Error('upload failed (HTTP 503)');
    }
    const stored = this.corrupt > 0 ? enc.encode('broken') : bytes;
    if (this.corrupt > 0) this.corrupt -= 1;
    this.files.set(path, stored);
  }

  get = async (path: string) => this.files.get(path) ?? null;
  list = async (prefix: string) => [...this.files.keys()].filter((p) => p.startsWith(`${prefix}/`));
}

const deps = (files: FakeLedger, sink: MemorySink, at = NOW): LedgerPushDeps => ({
  files,
  sink,
  clock: { now: () => at },
});

describe('pushLedgerMonth (#161 U7)', () => {
  it('copies the files and then the manifest, verifies them and records the copy', async () => {
    const ledger = new FakeLedger({ usage: 'u1\n', cost: 'c1\n' });
    const sink = new MemorySink();
    const result = await pushLedgerMonth(MONTH, deps(ledger, sink));
    expect(result.files.map((f) => [f.name, f.status, f.attempts])).toEqual([
      ['usage.jsonl.gz', 'uploaded', 1],
      ['cost.jsonl.gz', 'uploaded', 1],
      ['MANIFEST.json', 'uploaded', 1],
    ]);
    expect([...sink.files.keys()]).toEqual([
      '2026-09/usage.jsonl.gz',
      '2026-09/cost.jsonl.gz',
      '2026-09/MANIFEST.json',
    ]);
    expect(result.recorded).toBe(true);
    expect(ledger.manifestValue?.transfers).toEqual({
      memory: { transferredAt: NOW.toISOString(), files: 3 },
    });
    // The copied manifest never carries `transfers`.
    const copied = JSON.parse(dec.decode(sink.files.get('2026-09/MANIFEST.json'))) as object;
    expect('transfers' in copied).toBe(false);
  });

  it('is idempotent: a second run uploads nothing and keeps the record', async () => {
    const ledger = new FakeLedger({ usage: 'u1\n' });
    const sink = new MemorySink();
    await pushLedgerMonth(MONTH, deps(ledger, sink));
    const puts = sink.puts;
    const later = new Date('2026-11-10T05:00:00.000Z');
    const again = await pushLedgerMonth(MONTH, deps(ledger, sink, later));
    expect(sink.puts).toBe(puts);
    expect(again.files.every((f) => f.status === 'unchanged')).toBe(true);
    expect(again.recorded).toBe(false);
    expect(ledger.manifestValue?.transfers?.memory?.transferredAt).toBe(NOW.toISOString());
  });

  it('transfers encrypted files as stored and checks their encrypted hash', async () => {
    const ledger = new FakeLedger({ usage: 'secret\n' }, true);
    const sink = new MemorySink();
    await pushLedgerMonth(MONTH, deps(ledger, sink));
    expect(dec.decode(sink.files.get('2026-09/usage.jsonl.gz.enc'))).toBe('\nterces');
  });

  it('retries a failed or corrupted upload and fails after the last attempt', async () => {
    const ledger = new FakeLedger({ usage: 'u1\n' });
    const sink = new MemorySink();
    sink.fail = 1;
    sink.corrupt = 1;
    const result = await pushLedgerMonth(MONTH, deps(ledger, sink));
    expect(result.files[0]).toMatchObject({ status: 'uploaded', attempts: 3 });

    const broken = new MemorySink();
    broken.corrupt = 10;
    const fresh = new FakeLedger({ usage: 'u1\n' });
    await expect(pushLedgerMonth(MONTH, deps(fresh, broken))).rejects.toThrow(
      'memory: 2026-09/usage.jsonl.gz not copied after 3 attempt(s): the copy does not match MANIFEST.json',
    );
    // Nothing is recorded and the manifest is not copied when a file fails.
    expect(fresh.manifestValue?.transfers).toBeUndefined();
    expect(broken.files.has('2026-09/MANIFEST.json')).toBe(false);
  });

  it('replaces a stale copy and reports files only the copy has', async () => {
    const ledger = new FakeLedger({ usage: 'u2\n' });
    const sink = new MemorySink();
    sink.files.set('2026-09/usage.jsonl.gz', enc.encode('u1\n'));
    sink.files.set('2026-09/old.jsonl.gz', enc.encode('x'));
    const result = await pushLedgerMonth(MONTH, deps(ledger, sink));
    expect(result.files[0]?.status).toBe('uploaded');
    expect(result.extra).toEqual(['2026-09/old.jsonl.gz']);
    expect(sink.files.has('2026-09/old.jsonl.gz')).toBe(true);
  });

  it('refuses an unsealed month, a missing manifest and a ledger that does not match', async () => {
    const sink = new MemorySink();
    const unsealed = new FakeLedger({ usage: 'u\n' });
    unsealed.manifestValue = { ...unsealed.manifestValue!, sealed: false };
    await expect(pushLedgerMonth(MONTH, deps(unsealed, sink))).rejects.toThrow(/is not sealed/);
    const none = new FakeLedger({});
    none.manifestValue = null;
    await expect(pushLedgerMonth(MONTH, deps(none, sink))).rejects.toThrow(/no MANIFEST\.json/);
    const tampered = new FakeLedger({ usage: 'u\n' });
    tampered.texts.set('usage', 'changed\n');
    await expect(pushLedgerMonth(MONTH, deps(tampered, sink))).rejects.toThrow(
      /usage\.jsonl\.gz does not match MANIFEST\.json: nothing copied/,
    );
    const missing = new FakeLedger({ usage: 'u\n', cost: 'c\n' });
    missing.texts.delete('cost');
    await expect(pushLedgerMonth(MONTH, deps(missing, sink))).rejects.toThrow(
      /lacks 1 file\(s\) listed in MANIFEST\.json/,
    );
    expect(sink.puts).toBe(0);
  });
});

describe('transfer helpers', () => {
  it('accepts month paths only', () => {
    for (const ok of [
      '2026-09/usage.jsonl.gz',
      '2026-09/revisions/cost.jsonl.gz.enc',
      '2026-09/MANIFEST.json',
    ])
      expect(assertSinkPath(ok)).toBe(ok);
    for (const bad of [
      '../x',
      '2026-13/a',
      '2026-09/../a',
      '2026-09/a/b',
      '2026-09/',
      '/2026-09/a',
    ])
      expect(() => assertSinkPath(bad)).toThrow(/Invalid ledger sink path/);
  });

  it('keeps transfers through a manifest rebuild and drops them from the copy', () => {
    const transfers = { gdrive: { transferredAt: NOW.toISOString(), files: 2 } };
    const manifest = buildLedgerManifest(MONTH, [], { sealed: true, transfers });
    expect(manifest.transfers).toEqual(transfers);
    expect(ledgerManifestSchema.parse(manifest).transfers).toEqual(transfers);
    expect(transferManifestOf(manifest).transfers).toBeUndefined();
    expect(buildLedgerManifest(MONTH, [], { transfers: {} }).transfers).toBeUndefined();
  });

  it('builds a push alert keyed per month and sink', () => {
    expect(ledgerPushAlert(MONTH, 'gdrive', 'upload failed (HTTP 403)')).toMatchObject({
      key: 'ledger-push:2026-09:gdrive',
      severity: 'high',
      lines: [
        'upload failed (HTTP 403)',
        expect.stringContaining('pnpm ledger push --month 2026-09'),
      ],
    });
  });
});
