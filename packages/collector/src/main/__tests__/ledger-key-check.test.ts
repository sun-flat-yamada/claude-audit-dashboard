import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  OWNER,
  PIPELINE,
  expectCleanLogs,
  sealedPair,
  setup,
  tempDir,
} from '../../__tests__/encrypted-ledger.js';
import { generateIdentity, generatePipelineKey } from '../../adapters/storage/ledger-crypto.js';
import { FsLedgerRepository } from '../../adapters/storage/ledger.js';
import { ledgerCommand } from '../ledger.js';

vi.setConfig({ testTimeout: 90_000 });

/** A pipeline-key backup in the form `pnpm ledger keygen --pipeline` writes (comments first). */
const pipelineKeyFile = (key: string): string =>
  `# claude-audit ledger pipeline key: offline backup\n# (comment lines are skipped)\n${key}\n`;

/** Every file under `dir` with its size and modification time: proves that nothing was written. */
async function treeOf(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const info = await stat(path);
    files.push(`${relative(dir, path)} ${String(info.size)} ${String(info.mtimeMs)}`);
  }
  return files.sort();
}

/** Key files in a temporary directory outside the data directory. */
async function keyFiles() {
  const dir = await tempDir('ledger-key-files');
  const paths = {
    owner: join(dir, 'owner.key'),
    pipeline: join(dir, 'pipeline.key'),
    strangerPipeline: join(dir, 'stranger-pipeline.key'),
    stranger: join(dir, 'stranger.key'),
  };
  await writeFile(paths.owner, `# identity\n${OWNER.identity}\n`);
  await writeFile(paths.pipeline, pipelineKeyFile(PIPELINE));
  await writeFile(paths.strangerPipeline, pipelineKeyFile(generatePipelineKey()));
  await writeFile(paths.stranger, generateIdentity().identity);
  return paths;
}

describe('ledger decrypt with the pipeline-key backup (#174 U9)', () => {
  it('decrypts every file with the backup file and checks it against MANIFEST.json', async () => {
    const { encDir, plain } = await sealedPair();
    const keys = await keyFiles();
    const out = await tempDir('ledger-restore-out');
    const { c, log } = await setup(encDir);
    await ledgerCommand.run(c, ['decrypt', '--pipeline-key', keys.pipeline, '--out', out]);
    const expected = await new FsLedgerRepository(plain.c.store).decodedFiles('2026-09');
    expect(expected.length).toBeGreaterThan(0);
    for (const file of expected)
      expect(await readFile(join(out, '2026-09', `${file.name}.jsonl`), 'utf8')).toBe(file.text);
    expect(JSON.parse(await readFile(join(out, '2026-10', 'MANIFEST.json'), 'utf8'))).toEqual(
      JSON.parse(await readFile(join(encDir, 'ledger', '2026-10', 'MANIFEST.json'), 'utf8')),
    );
    expect(log.lines).toContainEqual(expect.stringMatching(/^info Ledger: \d+ file\(s\) of 2/));
    expectCleanLogs(log.lines);
  });

  it('refuses a pipeline key that does not match, without writing anything', async () => {
    const { encDir } = await sealedPair();
    const keys = await keyFiles();
    const out = await tempDir('ledger-restore-wrong');
    const { c } = await setup(encDir);
    await expect(
      ledgerCommand.run(c, ['decrypt', '--pipeline-key', keys.strangerPipeline, '--out', out]),
    ).rejects.toThrow(/no matching key/);
    await expect(
      ledgerCommand.run(c, ['decrypt', '--pipeline-key', keys.owner, '--out', out]),
    ).rejects.toThrow(/Invalid LEDGER_PIPELINE_KEY: .*\(value not shown\)/);
    await expect(ledgerCommand.run(c, ['decrypt', '--out', out])).rejects.toThrow(
      /requires --identity <file> or --pipeline-key <file>/,
    );
    expect(await readdir(out)).toEqual([]);
  });

  it('re-encrypts to a new pipeline key, reading with the backup of the old one', async () => {
    const { encDir } = await sealedPair();
    const keys = await keyFiles();
    const fresh = generatePipelineKey();
    const rotate = await setup(encDir, { recipients: [OWNER.recipient], pipelineKey: fresh });
    await ledgerCommand.run(rotate.c, ['encrypt', '--all', '--pipeline-key', keys.pipeline]);
    const old = await setup(encDir, { pipelineKey: PIPELINE });
    await expect(old.c.ledger().read('2026-09', 'usage')).rejects.toThrow(/no matching key/);
    await ledgerCommand.run(rotate.c, ['key-check']);
    expect(rotate.log.lines.at(-1)).toMatch(/^info Ledger key check pass/);
    expectCleanLogs(rotate.log.lines);
  });
});

describe('ledger key-check (#174 U9)', () => {
  it('reads every file with the selected key without writing plaintext or logging content', async () => {
    const { encDir } = await sealedPair();
    const keys = await keyFiles();
    const before = await treeOf(encDir);
    const viaEnv = await setup(encDir, { pipelineKey: PIPELINE });
    await ledgerCommand.run(viaEnv.c, ['key-check']);
    const local = await setup(encDir);
    await ledgerCommand.run(local.c, ['key-check', '--identity', keys.owner]);
    await ledgerCommand.run(local.c, ['key-check', '--pipeline-key', keys.pipeline]);
    await ledgerCommand.run(local.c, ['key-check', '--month', '2026-09', '--identity', keys.owner]);
    expect(await treeOf(encDir)).toEqual(before);
    expect(await readdir(join(keys.owner, '..'))).toHaveLength(4);

    expect(viaEnv.log.lines).toEqual([
      expect.stringMatching(
        /^info Ledger key check pass: (\d+) file\(s\) of 2 month\(s\), \1 encrypted, checked with the pipeline key [0-9a-f]{16}; every file matches MANIFEST.json$/,
      ),
    ]);
    expect(local.log.lines.map((l) => /checked with the (\w+)/.exec(l)?.[1])).toEqual([
      'identity',
      'pipeline',
      'identity',
    ]);
    expect(local.log.lines[2]).toMatch(/of 1 month\(s\)/);
    expectCleanLogs([...viaEnv.log.lines, ...local.log.lines]);
  });

  it('fails on a key that cannot read the files, naming the files but not the content', async () => {
    const { encDir } = await sealedPair();
    const keys = await keyFiles();
    const { c, log } = await setup(encDir, { pipelineKey: generatePipelineKey() });
    await expect(ledgerCommand.run(c, ['key-check'])).rejects.toThrow(
      /Ledger key check failed: \d+ finding\(s\)/,
    );
    await expect(ledgerCommand.run(c, ['key-check', '--identity', keys.stranger])).rejects.toThrow(
      /Ledger key check failed/,
    );
    expect(log.lines).toContainEqual(
      expect.stringMatching(
        /^error Ledger key check: 2026-09\/usage\.jsonl\.gz\.enc: unreadable: no matching key \(encrypted for x25519:[0-9a-f]{16}, x25519:[0-9a-f]{16}, pipeline:[0-9a-f]{16}\)$/,
      ),
    );
    expectCleanLogs(log.lines);
  });

  it('reports stored bytes, content and files that differ from MANIFEST.json', async () => {
    const { encDir, plainDir } = await sealedPair();
    const month = join(encDir, 'ledger', '2026-09');
    const bytes = await readFile(join(month, 'cost.jsonl.gz.enc'));
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    await writeFile(join(month, 'cost.jsonl.gz.enc'), bytes);
    const manifest = JSON.parse(await readFile(join(month, 'MANIFEST.json'), 'utf8')) as {
      datasets: Record<string, { encryptedSha256?: string }>;
    };
    const usage = manifest.datasets.usage;
    if (!usage) throw new Error('no usage entry');
    manifest.datasets.ghost = { ...usage };
    await writeFile(join(month, 'MANIFEST.json'), JSON.stringify(manifest));
    const enc = await setup(encDir, { pipelineKey: PIPELINE });
    await expect(ledgerCommand.run(enc.c, ['key-check', '--month', '2026-09'])).rejects.toThrow(
      /2 finding\(s\)/,
    );
    expect(enc.log.lines).toContainEqual(
      'error Ledger key check: 2026-09/cost.jsonl.gz.enc: stored bytes differ from encryptedSha256 in MANIFEST.json',
    );
    expect(enc.log.lines).toContainEqual(
      'error Ledger key check: 2026-09/ghost: listed in MANIFEST.json but missing',
    );

    // A plain ledger needs no key to read; its content is still checked against sha256.
    const plainMonth = join(plainDir, 'ledger', '2026-09');
    const { gzipSync } = await import('node:zlib');
    await writeFile(join(plainMonth, 'cost.jsonl.gz'), gzipSync('{"changed":true}\n'));
    const plain = await setup(plainDir, { pipelineKey: PIPELINE });
    await expect(ledgerCommand.run(plain.c, ['key-check'])).rejects.toThrow(/1 finding\(s\)/);
    expect(plain.log.lines).toContainEqual(
      'error Ledger key check: 2026-09/cost.jsonl.gz: content differs from sha256 in MANIFEST.json',
    );
    expectCleanLogs([...enc.log.lines, ...plain.log.lines]);
  });

  it('needs exactly one key', async () => {
    const { encDir } = await sealedPair();
    const keys = await keyFiles();
    const { c } = await setup(encDir);
    await expect(ledgerCommand.run(c, ['key-check'])).rejects.toThrow(
      /needs LEDGER_PIPELINE_KEY, --pipeline-key <file> or --identity <file>/,
    );
    await expect(
      ledgerCommand.run(c, [
        'key-check',
        '--identity',
        keys.owner,
        '--pipeline-key',
        keys.pipeline,
      ]),
    ).rejects.toThrow(/takes one key/);
    await expect(ledgerCommand.run(c, ['key-check', '--out', keys.owner])).rejects.toThrow(
      /Unknown option/,
    );
  });
});

describe('key commands on CI and in a Claude Code cloud session (#174 U9)', () => {
  const HOSTS = [
    { options: { ci: 'true' }, message: /refuses to run on CI/ },
    {
      options: { claudeCodeRemote: 'true' },
      message: /refuses to run on a Claude Code cloud session/,
    },
  ] as const;

  it('refuses every command that handles a private key, a key backup or plaintext', async () => {
    const { encDir } = await sealedPair();
    const keys = await keyFiles();
    const out = await tempDir('ledger-host-out');
    const keyOut = await tempDir('ledger-host-keys');
    for (const { options, message } of HOSTS) {
      const { c } = await setup(encDir, {
        ...options,
        recipients: [OWNER.recipient],
        pipelineKey: PIPELINE,
      });
      const refused: string[][] = [
        ['keygen', '--out', join(keyOut, 'new.key')],
        ['keygen', '--pipeline', '--out', join(keyOut, 'new-pipeline.key')],
        ['decrypt', '--identity', keys.owner, '--out', out],
        ['decrypt', '--pipeline-key', keys.pipeline, '--out', out],
        ['encrypt', '--all', '--identity', keys.owner],
        ['encrypt', '--all', '--pipeline-key', keys.pipeline],
        ['key-check', '--identity', keys.owner],
        ['key-check', '--pipeline-key', keys.pipeline],
      ];
      for (const args of refused)
        await expect(ledgerCommand.run(c, args), args.join(' ')).rejects.toThrow(message);
    }
    expect(await readdir(out)).toEqual([]);
    expect(await readdir(keyOut)).toEqual([]);
  });

  it('still checks the configured LEDGER_PIPELINE_KEY there (the workflow route)', async () => {
    const { encDir } = await sealedPair();
    for (const { options } of HOSTS) {
      const { c, log } = await setup(encDir, { ...options, pipelineKey: PIPELINE });
      await ledgerCommand.run(c, ['key-check']);
      expect(log.lines.at(-1)).toMatch(/^info Ledger key check pass/);
    }
  });
});
