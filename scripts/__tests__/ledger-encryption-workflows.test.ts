import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (name: string): string => readFileSync(join('.github/workflows', name), 'utf8');

const stepOf = (workflow: string, name: string): string =>
  workflow.slice(workflow.indexOf(`- name: ${name}`)).split('\n      - ')[0] ?? '';

/** The steps that read or write the ledger files (#162 U8). */
const LEDGER_STEPS: readonly [string, string][] = [
  ['collect-audit.yml', 'Collect, evaluate and build dashboard data'],
  ['ledger-backfill.yml', 'Backfill the ledger'],
  ['ledger-seal.yml', 'Seal the ledger month'],
  ['ledger-seal.yml', 'Copy the sealed month to external storage'],
  ['ledger-verify.yml', 'Verify the ledger'],
  ['ledger-key-check.yml', 'Check the ledger key'],
];

describe('ledger encryption wiring (#162)', () => {
  it('passes LEDGER_PIPELINE_KEY from the Actions secrets to every step that reads the ledger', () => {
    for (const [name, step] of LEDGER_STEPS)
      assert.match(
        stepOf(read(name), step),
        /\n {10}LEDGER_PIPELINE_KEY: \$\{\{ secrets\.LEDGER_PIPELINE_KEY \}\}\n/,
        `${name}: ${step}`,
      );
  });

  it('never runs ledger decrypt or keygen in a workflow', () => {
    for (const [name] of LEDGER_STEPS)
      assert.doesNotMatch(read(name), /ledger (decrypt|keygen)|LEDGER_IDENTITY/, name);
  });

  it('lists the secret as an empty value in .env.example', () => {
    assert.match(readFileSync('.env.example', 'utf8'), /^LEDGER_PIPELINE_KEY=$/m);
  });

  it('secret-scan has patterns for ledger private and pipeline keys', () => {
    const scanner = readFileSync('scripts/secret-scan.ts', 'utf8');
    // Assembled at run time so that this file itself never holds a key-shaped string.
    const body = 'A'.repeat(21) + 'b'.repeat(22);
    for (const prefix of ['SECRET', 'PIPELINE']) {
      const source = new RegExp(`/(CADL-${prefix}-\\[A-Za-z0-9_-\\]\\{43\\})/`).exec(scanner)?.[1];
      assert.ok(source, prefix);
      assert.match(['CADL', prefix, body].join('-'), new RegExp(source));
    }
  });
});

describe('ledger-key-check.yml (#174)', () => {
  const workflow = read('ledger-key-check.yml');

  it('runs monthly (opt-in) and manually, from main only, with read-only permissions', () => {
    assert.match(workflow, /\n {4}- cron: '0 5 11 \* \*'\n/);
    assert.match(workflow, /\n {2}workflow_dispatch:/);
    assert.match(workflow, /\npermissions:\n {2}contents: read\n/);
    assert.match(
      workflow,
      /if: github\.ref == 'refs\/heads\/main' && \(github\.event_name != 'schedule' \|\| vars\.ENABLE_SCHEDULED_JOBS == 'true'\)/,
    );
  });

  it('restores data/audit, checks the key, and never saves', () => {
    assert.match(
      stepOf(workflow, 'Restore stored data'),
      /run: \.github\/scripts\/data-branch\.sh restore\n/,
    );
    assert.match(stepOf(workflow, 'Check the ledger key'), /run: pnpm ledger key-check\n/);
    assert.ok(workflow.indexOf('Restore stored data') < workflow.indexOf('Check the ledger key'));
    assert.doesNotMatch(workflow, /data-branch\.sh save|contents: write|git push/);
  });

  it('never uses a key file, writes plaintext or uploads an artifact', () => {
    assert.doesNotMatch(
      workflow,
      /--identity|--pipeline-key|--out|upload-artifact|GITHUB_STEP_SUMMARY|LEDGER_IDENTITY/,
    );
    for (const line of workflow.split('\n').filter((l) => /^\s+run:/.test(l)))
      assert.ok(!line.includes('${{'), `expression in a run line: ${line}`);
  });
});
