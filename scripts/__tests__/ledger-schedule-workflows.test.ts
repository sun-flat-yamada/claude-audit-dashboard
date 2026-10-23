import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bashCmd =
  process.platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe')
    ? 'C:/Program Files/Git/bin/bash.exe'
    : 'bash';

const read = (name: string): string => readFileSync(join('.github/workflows', name), 'utf8');
const seal = read('ledger-seal.yml');
const verify = read('ledger-verify.yml');
const collect = read('collect-audit.yml');

function runScript(
  script: string,
  env: Record<string, string>,
): { status: number | null; output: string; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-schedule-'));
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
    return { status: result.status, output, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The text of every `run:` block (single line or literal block) of a workflow. */
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

const stepOf = (workflow: string, name: string): string =>
  workflow.slice(workflow.indexOf(`- name: ${name}`)).split('\n      - ')[0] ?? '';

describe('ledger-seal dispatch input', () => {
  const validate = (env: Record<string, string>) =>
    runScript('.github/scripts/validate-ledger-inputs.sh', env);

  it('accepts no input (the previous month) and a month', () => {
    assert.equal(validate({}).output, 'month=\n');
    const r = validate({ MONTH: '2026-09' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.output, 'month=2026-09\n');
  });

  it('rejects anything that is not a month, without echoing it', () => {
    for (const value of [
      '2026-9',
      '2026-13',
      '2026-00',
      '26-09',
      ' 2026-09',
      '2026-09 ',
      '2026-09; id',
      '$(id)',
      '`id`',
      '2026-09\n2026-10',
      '--month',
    ]) {
      const r = validate({ MONTH: value });
      assert.notEqual(r.status, 0, JSON.stringify(value));
      assert.equal(r.output, '');
      assert.ok(!r.stderr.includes(value.trim()), JSON.stringify(value));
    }
  });
});

describe('month-end guard', () => {
  const MONTH_END = '30 23 28-31 * *';
  const guard = (env: Record<string, string>) =>
    runScript('.github/scripts/month-end-guard.sh', env);

  it('runs every trigger other than the month-end schedule', () => {
    for (const schedule of ['', '0 */6 * * *'])
      assert.equal(guard({ SCHEDULE: schedule, GUARD_TODAY: '2026-10-28' }).output, 'run=true\n');
  });

  it('runs the month-end schedule only when the next UTC day is the 1st', () => {
    const cases: [string, boolean][] = [
      ['2026-10-31', true],
      ['2026-10-30', false],
      ['2026-09-30', true],
      ['2026-09-28', false],
      ['2026-02-28', true],
      ['2028-02-28', false],
      ['2028-02-29', true],
      ['2026-12-31', true],
    ];
    for (const [today, run] of cases) {
      const r = guard({ SCHEDULE: MONTH_END, GUARD_TODAY: today });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.output, `run=${String(run)}\n`, today);
    }
  });

  it('rejects a malformed date override', () => {
    for (const value of ['2026-1-31', '2026-10-32', '$(id)', '2026-10-31 '])
      assert.notEqual(guard({ SCHEDULE: MONTH_END, GUARD_TODAY: value }).status, 0, value);
  });

  it('is wired into collect-audit.yml before the restore and the pipeline', () => {
    assert.match(collect, /\n {4}- cron: '0 \*\/6 \* \* \*'\n/);
    assert.match(collect, /\n {4}- cron: '30 23 28-31 \* \*'\n/);
    assert.ok(readFileSync('.github/scripts/month-end-guard.sh', 'utf8').includes(MONTH_END));
    assert.match(
      stepOf(collect, 'Month-end guard'),
      /id: when\n\s+run: bash \.github\/scripts\/month-end-guard\.sh\n\s+env:\n\s+SCHEDULE: \$\{\{ github\.event\.schedule \}\}/,
    );
    for (const name of ['Restore stored data', 'Collect, evaluate and build dashboard data'])
      assert.match(stepOf(collect, name), /if: steps\.when\.outputs\.run == 'true'/, name);
    assert.ok(collect.indexOf('Month-end guard') < collect.indexOf('Restore stored data'));
  });
});

describe('ledger-seal.yml and ledger-verify.yml', () => {
  it('run on their schedules (opt-in) and manually, from main, in the audit-data group', () => {
    assert.match(seal, /\n {4}- cron: '0 4 10 \* \*'\n/);
    assert.match(verify, /\n {4}- cron: '30 5 \* \* \*'\n/);
    for (const workflow of [seal, verify]) {
      assert.match(workflow, /\n {2}workflow_dispatch:/);
      assert.match(workflow, /concurrency:\n {2}group: audit-data\n {2}cancel-in-progress: false/);
      assert.match(
        workflow,
        /if: github\.ref == 'refs\/heads\/main' && \(github\.event_name != 'schedule' \|\| vars\.ENABLE_SCHEDULED_JOBS == 'true'\)/,
      );
    }
  });

  it('never interpolate an expression into a shell script (injection-safe)', () => {
    for (const workflow of [seal, verify])
      for (const block of runBlocks(workflow))
        assert.ok(!block.includes('${{'), `expression in a run block: ${block}`);
  });

  it('pass the month input only to the validation step and read the validated output after', () => {
    assert.match(
      stepOf(seal, 'Validate manual inputs'),
      /run: bash \.github\/scripts\/validate-ledger-inputs\.sh\n\s+env:\n\s+MONTH: \$\{\{ inputs\.month \}\}/,
    );
    assert.equal((seal.match(/inputs\.month /g) ?? []).length, 1);
    const step = stepOf(seal, 'Seal the ledger month');
    assert.match(step, /MONTH: \$\{\{ steps\.inputs\.outputs\.month \}\}/);
    assert.match(step, /pnpm ledger seal "\$\{args\[@\]\}"/);
    assert.match(step, /args=\(--notify\)/);
    assert.match(stepOf(verify, 'Verify the ledger'), /run: pnpm ledger verify --notify/);
  });

  it('restore before and save after through data-branch.sh, also after a refused seal', () => {
    for (const [workflow, step] of [
      [seal, 'Seal the ledger month'],
      [verify, 'Verify the ledger'],
    ] as const) {
      assert.match(
        stepOf(workflow, 'Restore stored data'),
        /run: \.github\/scripts\/data-branch\.sh restore/,
      );
      const save = stepOf(workflow, 'Save data to the data/audit branch');
      assert.match(save, /\.github\/scripts\/data-branch\.sh save/);
      assert.match(save, /if: always\(\) && steps\.restore\.outcome == 'success'/);
      assert.ok(workflow.indexOf('Restore stored data') < workflow.indexOf(step));
      assert.ok(workflow.indexOf(step) < workflow.indexOf('Save data to the data/audit branch'));
      // Notifications reuse the existing channels.
      assert.match(
        stepOf(workflow, step),
        /SLACK_WEBHOOK_URL: \$\{\{ secrets\.SLACK_WEBHOOK_URL \}\}/,
      );
    }
  });
});

describe('ledger-seal.yml external storage copy (#161)', () => {
  const SINK_VARIABLES = [
    'LEDGER_SHAREPOINT_TENANT_ID',
    'LEDGER_SHAREPOINT_CLIENT_ID',
    'LEDGER_SHAREPOINT_DRIVE_ID',
    'LEDGER_SHAREPOINT_FOLDER',
    'LEDGER_GDRIVE_WORKLOAD_IDENTITY_PROVIDER',
    'LEDGER_GDRIVE_SERVICE_ACCOUNT',
    'LEDGER_GDRIVE_DRIVE_ID',
    'LEDGER_GDRIVE_FOLDER_ID',
  ];

  it('may request the OIDC token and keeps contents: write', () => {
    assert.match(seal, /\npermissions:\n {2}contents: write\n(?: {2}#.*\n)* {2}id-token: write\n/);
  });

  it('passes the storage identifiers from repository variables (never secrets) at job level', () => {
    const job = seal.slice(seal.indexOf('\n    env:\n'), seal.indexOf('\n    steps:\n') + 1);
    assert.match(job, /AUDIT_CONFIG_OVERRIDES: \$\{\{ vars\.AUDIT_CONFIG_OVERRIDES \}\}/);
    for (const name of SINK_VARIABLES) {
      assert.match(job, new RegExp(`\\n {6}${name}: \\$\\{\\{ vars\\.${name} \\}\\}\\n`), name);
      assert.doesNotMatch(seal, new RegExp(`secrets\\.${name}`), name);
    }
  });

  it('copies after a successful seal and before the save, with the validated month', () => {
    const step = stepOf(seal, 'Copy the sealed month to external storage');
    assert.match(step, /if: steps\.seal\.outcome == 'success'/);
    assert.match(step, /pnpm ledger push "\$\{args\[@\]\}"/);
    assert.match(step, /args=\(--notify\)/);
    assert.match(step, /MONTH: \$\{\{ steps\.inputs\.outputs\.month \}\}/);
    assert.match(step, /SLACK_WEBHOOK_URL: \$\{\{ secrets\.SLACK_WEBHOOK_URL \}\}/);
    assert.doesNotMatch(step, /ANTHROPIC_/);
    const at = (name: string) => seal.indexOf(`- name: ${name}`);
    assert.ok(at('Seal the ledger month') < at('Copy the sealed month to external storage'));
    assert.ok(
      at('Copy the sealed month to external storage') < at('Save data to the data/audit branch'),
    );
    const save = stepOf(seal, 'Save data to the data/audit branch');
    assert.match(save, /REPOSITORY_VISIBILITY: \$\{\{ github\.event\.repository\.visibility \}\}/);
    assert.match(save, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  });

  it('lists the variables empty in .env.example', () => {
    const example = readFileSync('.env.example', 'utf8');
    for (const name of [...SINK_VARIABLES, 'LEDGER_SINK_DIR'])
      assert.match(example, new RegExp(`^${name}=$`, 'm'), name);
  });
});
