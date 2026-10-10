import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = '.github/scripts/validate-dispatch-inputs.sh';
const workflow = readFileSync('.github/workflows/collect-audit.yml', 'utf8');

const bashCmd =
  process.platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe')
    ? 'C:/Program Files/Git/bin/bash.exe'
    : 'bash';

function validate(env: Record<string, string>): {
  status: number | null;
  output: string;
  stderr: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-inputs-'));
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

describe('collect-audit dispatch inputs', () => {
  it('accepts no input (scheduled run) and defaults to no override and no dry run', () => {
    const r = validate({});
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.output, 'retention_days=\ndry_run=false\n');
  });

  it('accepts a whole number of days and the booleans', () => {
    for (const days of ['1', '7', '365', '99999']) {
      const r = validate({ RETENTION_DAYS: days, DRY_RUN: 'true' });
      assert.equal(r.status, 0, `${days}: ${r.stderr}`);
      assert.equal(r.output, `retention_days=${days}\ndry_run=true\n`);
    }
    assert.equal(validate({ DRY_RUN: 'false' }).output, 'retention_days=\ndry_run=false\n');
  });

  it('rejects anything that is not a plain positive integer, without echoing it', () => {
    const hostile = [
      '0',
      '-1',
      '1.5',
      '01',
      '100000',
      '7 ',
      ' 7',
      '7; rm -rf /',
      '$(id)',
      '`id`',
      '7\n8',
      '7"',
      '--days',
      'abc',
    ];
    for (const value of hostile) {
      const r = validate({ RETENTION_DAYS: value });
      assert.notEqual(r.status, 0, JSON.stringify(value));
      assert.equal(r.output, '', JSON.stringify(value));
      assert.ok(!r.stderr.includes(value.trim()) || value.trim() === '', JSON.stringify(value));
    }
  });

  it('rejects a dry_run value other than true / false', () => {
    for (const value of ['yes', '1', 'TRUE', 'true; id', '$(id)']) {
      const r = validate({ DRY_RUN: value });
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

describe('collect-audit.yml', () => {
  it('declares the retention override and dry-run inputs for manual runs', () => {
    assert.match(workflow, /workflow_dispatch:\n\s+inputs:\n\s+retention_days:/);
    assert.match(workflow, /\n\s+dry_run:\n(?:.*\n)*?\s+type: boolean/);
  });

  it('never interpolates an expression into a shell script (injection-safe)', () => {
    for (const block of runBlocks(workflow)) {
      assert.ok(!block.includes('${{'), `expression in a run block: ${block}`);
    }
  });

  it('passes the inputs to the validation step only through env, and reads validated outputs after', () => {
    assert.match(
      workflow,
      /id: inputs\n\s+run: bash \.github\/scripts\/validate-dispatch-inputs\.sh\n\s+env:\n\s+RETENTION_DAYS: \$\{\{ inputs\.retention_days \}\}\n\s+DRY_RUN: \$\{\{ inputs\.dry_run \}\}/,
    );
    assert.equal((workflow.match(/inputs\.retention_days/g) ?? []).length, 1);
    assert.equal((workflow.match(/inputs\.dry_run/g) ?? []).length, 1);
    assert.match(workflow, /RETENTION_DAYS: \$\{\{ steps\.inputs\.outputs\.retention_days \}\}/);
    assert.match(workflow, /pnpm archive \$\{RETENTION_DAYS:\+--days "\$RETENTION_DAYS"\}/);
  });

  it('a dry run sends no alert and saves nothing', () => {
    const guard = "steps.inputs.outputs.dry_run != 'true'";
    for (const name of ['Send alerts', 'Save data to the data/audit branch']) {
      const step = workflow.slice(workflow.indexOf(`- name: ${name}`)).split('\n      - ')[0] ?? '';
      assert.ok(step.includes(guard), name);
    }
  });

  it('measures the size without ever failing the collection', () => {
    const step =
      workflow.slice(workflow.indexOf('- name: Measure data/audit size')).split('\n      - ')[0] ??
      '';
    assert.match(step, /continue-on-error: true/);
    assert.match(step, /pnpm size --repo \. --ref refs\/audit-size\/head --warn-only/);
    // Before the save, so the alert cooldown it records is persisted with the state.
    assert.ok(
      workflow.indexOf('Measure data/audit size') <
        workflow.indexOf('Save data to the data/audit branch'),
    );
  });
});
