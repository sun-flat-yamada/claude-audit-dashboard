import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = '.github/scripts/validate-backfill-inputs.sh';
const workflow = readFileSync('.github/workflows/ledger-backfill.yml', 'utf8');

const bashCmd =
  process.platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe')
    ? 'C:/Program Files/Git/bin/bash.exe'
    : 'bash';

function validate(env: Record<string, string>): {
  status: number | null;
  output: string;
  stderr: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'backfill-inputs-'));
  const out = join(dir, 'output').replaceAll('\\', '/');
  try {
    const result = spawnSync(bashCmd, [script], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, ...env },
      encoding: 'utf8',
    });
    let output = '';
    try {
      output = readFileSync(out, 'utf8');
    } catch {
      // Not written when validation fails.
    }
    return { status: result.status, output, stderr: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HOSTILE = [
  '',
  '2026-1',
  '2026-13',
  '2026-00',
  '26-01',
  '2026-01 ',
  ' 2026-01',
  '2026-01; id',
  '$(id)',
  '`id`',
  '2026-01\n2026-02',
  '--from',
];

describe('ledger-backfill dispatch inputs', () => {
  it('accepts a month and defaults the optional inputs', () => {
    const r = validate({ FROM: '2026-01' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.output, 'from=2026-01\nto=\ndatasets=\nforce=false\n');
  });

  it('accepts every input when valid', () => {
    const r = validate({
      FROM: '2026-01',
      TO: '2026-12',
      DATASETS: 'usage,cost,memberActivityDaily',
      FORCE: 'true',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      r.output,
      'from=2026-01\nto=2026-12\ndatasets=usage,cost,memberActivityDaily\nforce=true\n',
    );
  });

  it('rejects a malformed from / to without echoing it', () => {
    for (const value of HOSTILE) {
      const from = validate({ FROM: value });
      assert.notEqual(from.status, 0, JSON.stringify(value));
      assert.equal(from.output, '');
      assert.ok(value.trim() === '' || !from.stderr.includes(value.trim()), JSON.stringify(value));
      if (value === '') continue;
      const to = validate({ FROM: '2026-01', TO: value });
      assert.notEqual(to.status, 0, JSON.stringify(value));
      assert.equal(to.output, '');
    }
  });

  it('rejects datasets that are not plain comma-separated names', () => {
    for (const value of [
      'usage cost',
      'usage,',
      ',usage',
      'usage;id',
      '$(id)',
      'usage,,cost',
      'a-b',
    ]) {
      const r = validate({ FROM: '2026-01', DATASETS: value });
      assert.notEqual(r.status, 0, value);
      assert.equal(r.output, '');
      assert.ok(!r.stderr.includes(value), value);
    }
  });

  it('rejects a force value other than true / false', () => {
    for (const value of ['yes', '1', 'TRUE', 'true; id']) {
      const r = validate({ FROM: '2026-01', FORCE: value });
      assert.notEqual(r.status, 0, value);
      assert.equal(r.output, '');
    }
  });
});

/** The text of every `run:` block (single line or literal block) of the workflow. */
function runBlocks(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)run:\s*(.*)$/.exec(lines[i] ?? '');
    if (!match) continue;
    const indent = (match[1] ?? '').length;
    if (match[2] !== '|' && match[2] !== '>') {
      blocks.push(match[2] ?? '');
      continue;
    }
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j] ?? '';
      if (line.trim() !== '' && line.length - line.trimStart().length <= indent) break;
      body.push(line);
    }
    blocks.push(body.join('\n'));
  }
  return blocks;
}

const step = (name: string): string =>
  workflow.slice(workflow.indexOf(`- name: ${name}`)).split('\n      - ')[0] ?? '';

describe('ledger-backfill.yml', () => {
  it('is a manual workflow restricted to main in the audit-data concurrency group', () => {
    assert.match(workflow, /\non:\n {2}workflow_dispatch:\n/);
    assert.ok(!/\n {2}schedule:/.test(workflow), 'no schedule');
    assert.match(workflow, /concurrency:\n {2}group: audit-data\n {2}cancel-in-progress: false/);
    assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  });

  it('never interpolates an expression into a shell script (injection-safe)', () => {
    for (const block of runBlocks(workflow)) {
      assert.ok(!block.includes('${{'), `expression in a run block: ${block}`);
    }
  });

  it('passes the inputs only to the validation step and reads the validated outputs after', () => {
    assert.match(
      step('Validate manual inputs'),
      /run: bash \.github\/scripts\/validate-backfill-inputs\.sh\n\s+env:\n\s+FROM: \$\{\{ inputs\.from \}\}\n\s+TO: \$\{\{ inputs\.to \}\}\n\s+DATASETS: \$\{\{ inputs\.datasets \}\}\n\s+FORCE: \$\{\{ inputs\.force \}\}/,
    );
    for (const input of ['from', 'to', 'datasets', 'force'])
      assert.equal((workflow.match(new RegExp(`inputs\\.${input} `, 'g')) ?? []).length, 1, input);
    const backfill = step('Backfill the ledger');
    assert.match(backfill, /FROM: \$\{\{ steps\.inputs\.outputs\.from \}\}/);
    assert.match(backfill, /pnpm ledger backfill "\$\{args\[@\]\}"/);
  });

  it('restores and saves the data branch through data-branch.sh, also after a failed unit', () => {
    assert.match(step('Restore stored data'), /run: \.github\/scripts\/data-branch\.sh restore/);
    const save = step('Save data to the data/audit branch');
    assert.match(save, /\.github\/scripts\/data-branch\.sh save/);
    assert.match(save, /if: always\(\) && steps\.restore\.outcome == 'success'/);
    assert.ok(workflow.indexOf('Restore stored data') < workflow.indexOf('Backfill the ledger'));
  });
});
