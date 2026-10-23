import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { recordRevisions } from '@claude-audit/core';
import { describe, expect, it, vi } from 'vitest';
import {
  OWNER,
  PIPELINE,
  SECOND,
  encrypted,
  expectCleanLogs,
  filesOf,
  manifestOf,
  sealedPair,
  setup,
  tempDir,
} from '../../__tests__/encrypted-ledger.js';
import {
  generateIdentity,
  generatePipelineKey,
  isEncryptedEnvelope,
} from '../../adapters/storage/ledger-crypto.js';
import { FsLedgerRepository } from '../../adapters/storage/ledger.js';
import { ledgerCommand } from '../ledger.js';

vi.setConfig({ testTimeout: 90_000 });

describe('encrypted ledger (#162 U8)', () => {
  it('backfills, seals and verifies with the same content hashes as a plain ledger', async () => {
    const { plainDir, encDir, enc } = await sealedPair();
    const files = await filesOf(encDir, '2026-09');
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((n) => n.endsWith('.jsonl.gz.enc'))).toBe(true);
    for (const name of files)
      expect(isEncryptedEnvelope(await readFile(join(encDir, 'ledger', '2026-09', name)))).toBe(
        true,
      );

    const plainManifest = await manifestOf(plainDir, '2026-09');
    const encManifest = await manifestOf(encDir, '2026-09');
    expect(encManifest.sealed).toBe(true);
    for (const [dataset, entry] of Object.entries(encManifest.datasets)) {
      expect(entry.sha256).toBe(plainManifest.datasets[dataset]?.sha256);
      expect(entry.count).toBe(plainManifest.datasets[dataset]?.count);
      const bytes = await readFile(join(encDir, 'ledger', '2026-09', `${dataset}.jsonl.gz.enc`));
      expect(entry.encryptedSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
    expect(plainManifest.datasets.usage?.encryptedSha256).toBeUndefined();

    await ledgerCommand.run(enc.c, ['verify']);
    expect(enc.log.lines).toContainEqual(
      'info Ledger verify pass: 2 month(s), 1 sealed, 0 finding(s)',
    );
    expectCleanLogs(enc.log.lines);
  });

  it('keeps an unchanged month byte-identical and records encrypted revisions', async () => {
    const { encDir, enc } = await sealedPair();
    const before = await readFile(join(encDir, 'ledger', '2026-10', 'usage.jsonl.gz.enc'));
    await ledgerCommand.run(enc.c, ['update']);
    expect(
      (await readFile(join(encDir, 'ledger', '2026-10', 'usage.jsonl.gz.enc'))).equals(before),
    ).toBe(true);

    const repository = enc.c.ledger();
    const [first] = await repository.read('2026-09', 'cost');
    if (!first) throw new Error('no cost entry');
    const later = '2026-10-24T06:00:00.000Z';
    const changed = {
      ...first,
      asOf: later,
      recordedAt: later,
      item: { ...(first.item as object), amount: 1 },
    };
    expect(await recordRevisions(repository, '2026-09', 'cost', [changed])).toBe(1);
    const revision = await readFile(
      join(encDir, 'ledger', '2026-09', 'revisions', 'cost.jsonl.gz.enc'),
    );
    expect(isEncryptedEnvelope(revision)).toBe(true);
    expect((await manifestOf(encDir, '2026-09')).revisions?.cost?.encryptedSha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
    await ledgerCommand.run(enc.c, ['verify']);
    expect(enc.log.lines.at(-1)).toMatch(/Ledger verify pass/);
  });

  it('reports a stored file that differs from the encrypted hash in the manifest', async () => {
    const { encDir, enc } = await sealedPair();
    const path = join(encDir, 'ledger', '2026-09', 'cost.jsonl.gz.enc');
    // Re-encrypting the same content gives other bytes: the content hash still matches.
    const manifest = await manifestOf(encDir, '2026-09');
    const stored = await readFile(path);
    expect(await enc.c.ledger().reencode('2026-09', true)).toBeGreaterThan(0);
    expect((await manifestOf(encDir, '2026-09')).sealed).toBe(true);
    await writeFile(join(encDir, 'ledger', '2026-09', 'MANIFEST.json'), JSON.stringify(manifest));
    expect((await readFile(path)).equals(stored)).toBe(false);
    await ledgerCommand.run(enc.c, ['verify']);
    expect(enc.log.lines.join('\n')).toMatch(
      /cost: encrypted file hash differs from MANIFEST.json/,
    );
  });

  it('cannot be read without a key and fails closed without the pipeline key', async () => {
    const { encDir } = await sealedPair();
    const noKey = await setup(encDir);
    await expect(noKey.c.ledger().read('2026-09', 'usage')).rejects.toThrow(
      /Unreadable ledger file .*no ledger key is configured/,
    );
    const wrongKey = await setup(encDir, { pipelineKey: generatePipelineKey() });
    await expect(wrongKey.c.ledger().read('2026-09', 'usage')).rejects.toThrow(/no matching key/);
    const missing = await setup(encDir, { recipients: [OWNER.recipient] });
    await expect(ledgerCommand.run(missing.c, ['update'])).rejects.toThrow(
      /LEDGER_PIPELINE_KEY is not/,
    );
  });
});

describe('ledger keygen, encrypt and decrypt (#162 U8)', () => {
  it('generates keys outside the repository and never logs the private key', async () => {
    const dir = await tempDir('ledger-keys');
    const keys = await tempDir('ledger-keyfiles');
    const { c, log } = await setup(dir);
    await ledgerCommand.run(c, ['keygen', '--out', join(keys, 'owner.key')]);
    await ledgerCommand.run(c, ['keygen', '--pipeline', '--out', join(keys, 'pipeline.key')]);
    const identity = await readFile(join(keys, 'owner.key'), 'utf8');
    expect(identity).toMatch(/^CADL-SECRET-[A-Za-z0-9_-]{43}$/m);
    expect(await readFile(join(keys, 'pipeline.key'), 'utf8')).toMatch(
      /^CADL-PIPELINE-[A-Za-z0-9_-]{43}$/m,
    );
    expect(log.lines.some((l) => /cadl-pub-[A-Za-z0-9_-]{43}/.test(l))).toBe(true);
    expectCleanLogs(log.lines);
    await expect(
      ledgerCommand.run(c, ['keygen', '--out', join(keys, 'owner.key')]),
    ).rejects.toThrow(/EEXIST/);
    await expect(
      ledgerCommand.run(c, ['keygen', '--out', join(dir, 'ledger', 'x.key')]),
    ).rejects.toThrow(/outside the data directory and the repository/);
    const ci = await setup(dir, { ci: 'true' });
    await expect(
      ledgerCommand.run(ci.c, ['keygen', '--out', join(keys, 'ci.key')]),
    ).rejects.toThrow(/refuses to run on CI/);
  });

  it('migrates a plain ledger, sealed month included, and decrypts it with a local key', async () => {
    const dir = await tempDir('ledger-migrate');
    const keys = await tempDir('ledger-migrate-keys');
    const out = await tempDir('ledger-migrate-out');
    const plain = await setup(dir);
    await ledgerCommand.run(plain.c, ['backfill', '--from', '2026-09', '--to', '2026-10']);
    await ledgerCommand.run(plain.c, ['seal', '--month', '2026-09']);
    const plainManifest = await manifestOf(dir, '2026-09');
    const plainText = await new FsLedgerRepository(plain.c.store).decodedFiles('2026-09');

    const enc = await encrypted(dir);
    await expect(ledgerCommand.run(plain.c, ['encrypt'])).rejects.toThrow(/encryption is off/);
    await ledgerCommand.run(enc.c, ['encrypt']);
    expect((await filesOf(dir, '2026-09')).every((n) => n.endsWith('.enc'))).toBe(true);
    const migrated = await manifestOf(dir, '2026-09');
    expect(migrated.sealed).toBe(true);
    expect(migrated.seal).toEqual(plainManifest.seal);
    expect(migrated.datasets.usage?.sha256).toBe(plainManifest.datasets.usage?.sha256);
    expect(migrated.datasets.usage?.encryptedSha256).toMatch(/^[0-9a-f]{64}$/);
    await ledgerCommand.run(enc.c, ['verify']);
    expect(enc.log.lines).toContainEqual(
      'info Ledger verify pass: 2 month(s), 1 sealed, 0 finding(s)',
    );

    await writeFile(join(keys, 'second.key'), `${SECOND.identity}\n`);
    await ledgerCommand.run(plain.c, [
      'decrypt',
      '--identity',
      join(keys, 'second.key'),
      '--out',
      out,
      '--month',
      '2026-09',
    ]);
    for (const file of plainText)
      expect(await readFile(join(out, '2026-09', `${file.name}.jsonl`), 'utf8')).toBe(file.text);
    expectCleanLogs([...plain.log.lines, ...enc.log.lines]);
  });

  it('rotates a lost pipeline key with a local private key', async () => {
    const { encDir } = await sealedPair();
    const keys = await tempDir('ledger-rotate-keys');
    await writeFile(join(keys, 'owner.key'), OWNER.identity);
    const fresh = generatePipelineKey();
    const rotate = await setup(encDir, { recipients: [OWNER.recipient], pipelineKey: fresh });
    await expect(ledgerCommand.run(rotate.c, ['encrypt', '--all'])).rejects.toThrow(
      /no matching key/,
    );
    await ledgerCommand.run(rotate.c, ['encrypt', '--all', '--identity', join(keys, 'owner.key')]);
    expect(await rotate.c.ledger().read('2026-09', 'usage')).not.toHaveLength(0);
    const old = await setup(encDir, { pipelineKey: PIPELINE });
    await expect(old.c.ledger().read('2026-09', 'usage')).rejects.toThrow(/no matching key/);
    await ledgerCommand.run(rotate.c, ['verify']);
    expect(rotate.log.lines.at(-1)).toMatch(/Ledger verify pass/);
    expectCleanLogs(rotate.log.lines);
  });

  it('refuses decryption with a wrong key, on CI or into the repository', async () => {
    const { encDir } = await sealedPair();
    const keys = await tempDir('ledger-decrypt-keys');
    const out = await tempDir('ledger-decrypt-out');
    const stranger = generateIdentity();
    await writeFile(join(keys, 'stranger.key'), stranger.identity);
    await writeFile(join(keys, 'owner.key'), OWNER.identity);
    const { c } = await setup(encDir);
    const run = (identity: string, target: string) =>
      ledgerCommand.run(c, ['decrypt', '--identity', join(keys, identity), '--out', target]);
    await expect(run('stranger.key', out)).rejects.toThrow(/no matching key/);
    await expect(run('owner.key', join(encDir, 'plain'))).rejects.toThrow(
      /outside the data directory and the repository/,
    );
    const ci = await setup(encDir, { ci: 'true' });
    await expect(
      ledgerCommand.run(ci.c, ['decrypt', '--identity', join(keys, 'owner.key'), '--out', out]),
    ).rejects.toThrow(/refuses to run on CI/);
    await run('owner.key', out);
    expect((await readdir(join(out, '2026-09'))).sort()).toContain('usage.jsonl');
  });
});
