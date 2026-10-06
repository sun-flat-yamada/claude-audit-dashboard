/**
 * One-command full verification (`pnpm verify:all`, issue #41 / #122).
 *
 * Runs every quality gate of `.agents/rules/quality-rules-gate.md` plus the browser suite in a fixed order
 * and stops at the first failing step with that step's exit code. Local runs, the release pull request and
 * `.github/workflows/release.yml` use the same command; `ci.yml` keeps its parallel jobs for speed (a guard test
 * asserts that it still covers every step).
 *
 *   pnpm verify:all           # run all steps (10+ minutes: includes the E2E and axe suite)
 *   pnpm verify:all --list    # print the steps without running them
 *
 * The E2E step needs a Chromium. In a Claude Code cloud session it is preinstalled under /opt/pw-browsers
 * (PLAYWRIGHT_BROWSERS_PATH); elsewhere run `pnpm --filter @claude-audit/dashboard exec playwright install --with-deps chromium`
 * once (the release workflow does).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export interface VerifyStep {
  /** Root package.json script that is run with `pnpm run` */
  readonly script: string;
  readonly description: string;
}

/** The gate, in execution order. Changing it also changes docs (AGENTS.md rule 5, BLUEPRINT 18.2). */
export const VERIFY_STEPS: readonly VerifyStep[] = [
  { script: 'fork:verify', description: 'Code / data separation and sample contract' },
  { script: 'typecheck', description: 'Type check of every package' },
  { script: 'test', description: 'Unit, component, golden and script tests' },
  { script: 'secret-scan', description: 'Secret and PII scan' },
  { script: 'build', description: 'Production build of every package' },
  { script: 'lint', description: 'ESLint' },
  { script: 'format:check', description: 'Prettier check' },
  { script: 'audit:deps', description: 'Dependency audit (high and above)' },
  { script: 'test:e2e', description: 'Playwright E2E and axe accessibility suite' },
];

/** Runs one step and returns its exit code (non-zero = failed). */
export type StepRunner = (step: VerifyStep) => number;

export interface VerifyOutcome {
  readonly ok: boolean;
  /** Steps that were started, in order (the failing one is last when `ok` is false) */
  readonly ran: readonly string[];
  readonly failed?: string;
  readonly exitCode: number;
}

export function runVerify(steps: readonly VerifyStep[], runner: StepRunner): VerifyOutcome {
  const ran: string[] = [];
  for (const step of steps) {
    ran.push(step.script);
    const code = runner(step);
    if (code !== 0) {
      return { ok: false, ran, failed: step.script, exitCode: code };
    }
  }
  return { ok: true, ran, exitCode: 0 };
}

export function formatPlan(steps: readonly VerifyStep[]): string {
  return steps
    .map((s, i) => `${String(i + 1).padStart(2, ' ')}. pnpm ${s.script} - ${s.description}`)
    .join('\n');
}

function pnpmRunner(step: VerifyStep): number {
  console.log(`\n[verify:all] > pnpm run ${step.script}`);
  const result = spawnSync('pnpm', ['run', step.script], { stdio: 'inherit' });
  if (result.error) {
    console.error(`[verify:all] could not start pnpm: ${result.error.message}`);
    return 127;
  }
  return result.status ?? 1;
}

function main(): void {
  if (process.argv.includes('--list')) {
    console.log(formatPlan(VERIFY_STEPS));
    return;
  }
  const outcome = runVerify(VERIFY_STEPS, pnpmRunner);
  if (outcome.ok) {
    console.log(`\n[verify:all] ✅ all ${VERIFY_STEPS.length} steps passed`);
    return;
  }
  console.error(
    `\n[verify:all] ❌ step "${outcome.failed}" failed (exit ${outcome.exitCode}); ` +
      `${VERIFY_STEPS.length - outcome.ran.length} later step(s) were not run`,
  );
  process.exit(outcome.exitCode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
