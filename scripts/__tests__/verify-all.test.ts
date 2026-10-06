import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERIFY_STEPS, formatPlan, runVerify, type VerifyStep } from '../verify-all.js';

const steps: VerifyStep[] = [
  { script: 'a', description: 'first' },
  { script: 'b', description: 'second' },
  { script: 'c', description: 'third' },
];

describe('verify:all runner', () => {
  it('runs every step in order and succeeds when all exit 0', () => {
    const seen: string[] = [];
    const out = runVerify(steps, (s) => {
      seen.push(s.script);
      return 0;
    });
    assert.deepEqual(seen, ['a', 'b', 'c']);
    assert.deepEqual(out, { ok: true, ran: ['a', 'b', 'c'], exitCode: 0 });
  });

  it('stops at the first failure, keeps its exit code and never starts later steps', () => {
    const seen: string[] = [];
    const out = runVerify(steps, (s) => {
      seen.push(s.script);
      return s.script === 'b' ? 3 : 0;
    });
    assert.deepEqual(seen, ['a', 'b']);
    assert.equal(out.ok, false);
    assert.equal(out.failed, 'b');
    assert.equal(out.exitCode, 3);
    assert.deepEqual(out.ran, ['a', 'b']);
  });

  it('fails on the very first step without running anything else', () => {
    const seen: string[] = [];
    const out = runVerify(steps, (s) => {
      seen.push(s.script);
      return 1;
    });
    assert.deepEqual(seen, ['a']);
    assert.equal(out.failed, 'a');
  });

  it('runs nothing and succeeds for an empty list', () => {
    assert.equal(runVerify([], () => 1).ok, true);
  });
});

describe('verify:all step list', () => {
  it('has the documented order', () => {
    assert.deepEqual(
      VERIFY_STEPS.map((s) => s.script),
      [
        'fork:verify',
        'typecheck',
        'test',
        'secret-scan',
        'build',
        'lint',
        'format:check',
        'audit:deps',
        'test:e2e',
      ],
    );
  });

  it('only names scripts that exist in the root package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const step of VERIFY_STEPS) {
      assert.ok(pkg.scripts[step.script], `missing script ${step.script}`);
    }
    assert.match(pkg.scripts['verify:all'] ?? '', /verify-all\.ts/);
  });

  it('prints a numbered plan', () => {
    assert.match(formatPlan(VERIFY_STEPS), /^ 1\. pnpm fork:verify/);
    assert.equal(formatPlan(VERIFY_STEPS).split('\n').length, VERIFY_STEPS.length);
  });

  it('is covered by the parallel CI jobs, which keep their names', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    for (const cmd of ['fork:verify', 'lint', 'typecheck', 'format:check', 'audit:deps']) {
      assert.ok(ci.includes(`run: pnpm ${cmd}`), `ci.yml no longer runs pnpm ${cmd}`);
    }
    assert.ok(/run: pnpm test$/m.test(ci), 'ci.yml no longer runs pnpm test');
    assert.ok(/run: pnpm build$/m.test(ci), 'ci.yml no longer runs pnpm build');
    assert.ok(ci.includes('pnpm --filter @claude-audit/dashboard test:e2e'));
    for (const name of [
      'Lint, types & fork safety',
      'Test',
      'Dependency audit',
      'Build',
      'E2E and accessibility',
    ]) {
      assert.ok(ci.includes(`name: ${name}\n`), `CI job name changed: ${name}`);
    }
  });
});
