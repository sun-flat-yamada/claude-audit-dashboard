import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseEnvFile,
  isAutoPilotValue,
  resolveAutoPilot,
  deriveChangeDevPolicy,
  evaluateMergeReadiness,
  isSelfApprovalRejection,
  type PullSnapshot,
} from '../change-dev-autopilot.js';

const OPEN: PullSnapshot = {
  state: 'open',
  merged: false,
  draft: false,
  mergeableState: 'clean',
  headSha: 'abc',
};

describe('change-dev Auto-Pilot: resolving CHG_DEV_AUTO_PILOT', () => {
  it('parses .env lines with comments and quotes', () => {
    assert.deepEqual(parseEnvFile('# c\nA=1\nB="x # y"\nC=true # note\nexport D=no\n'), {
      A: '1',
      B: 'x # y',
      C: 'true',
      D: 'no',
    });
  });

  it('accepts true (any case) and 1 only', () => {
    for (const v of ['true', 'TRUE', ' True ', '1']) assert.equal(isAutoPilotValue(v), true, v);
    for (const v of ['false', '0', 'yes', '', undefined, null])
      assert.equal(isAutoPilotValue(v), false, String(v));
  });

  it('resolves process env → .env → .env.example, first non-empty value wins', () => {
    const example = { CHG_DEV_AUTO_PILOT: 'true' };
    assert.deepEqual(resolveAutoPilot({ env: {}, dotEnvExample: example }), {
      enabled: true,
      source: '.env.example',
      raw: 'true',
    });
    assert.equal(
      resolveAutoPilot({ env: {}, dotEnv: { CHG_DEV_AUTO_PILOT: 'false' }, dotEnvExample: example })
        .enabled,
      false,
    );
    const fromEnv = resolveAutoPilot({
      env: { CHG_DEV_AUTO_PILOT: '0' },
      dotEnv: { CHG_DEV_AUTO_PILOT: 'true' },
    });
    assert.equal(fromEnv.source, 'process-env');
    assert.equal(fromEnv.enabled, false);
    assert.equal(
      resolveAutoPilot({ env: { CHG_DEV_AUTO_PILOT: '' }, dotEnvExample: example }).source,
      '.env.example',
    );
    assert.deepEqual(resolveAutoPilot({ env: {} }), { enabled: false, source: 'unset', raw: null });
  });

  it('the repository default (.env.example) keeps Auto-Pilot off (manual: plan approval, draft PR)', () => {
    const text = fs.readFileSync(path.resolve(import.meta.dirname, '../../.env.example'), 'utf-8');
    assert.equal(resolveAutoPilot({ env: {}, dotEnvExample: parseEnvFile(text) }).enabled, false);
  });
});

describe('change-dev Auto-Pilot: policy branches', () => {
  it('Auto-Pilot on: no plan wait, ready PR, auto merge', () => {
    const p = deriveChangeDevPolicy(true, false);
    assert.equal(p.planGate, 'proceed-and-report');
    assert.equal(p.prDraft, false);
    assert.equal(p.afterPr, 'auto-merge');
  });

  it('Auto-Pilot off: wait for plan approval, draft PR, manual merge', () => {
    const p = deriveChangeDevPolicy(false, false);
    assert.equal(p.planGate, 'await-user-approval');
    assert.equal(p.prDraft, true);
    assert.equal(p.afterPr, 'manual');
  });

  it('cloud sessions use REST through the GitHub proxy and the session branch', () => {
    assert.equal(deriveChangeDevPolicy(true, true).githubTransport, 'rest-via-proxy');
    assert.equal(deriveChangeDevPolicy(true, true).workspace, 'session-branch');
    assert.equal(deriveChangeDevPolicy(true, false).githubTransport, 'gh-cli');
    assert.equal(deriveChangeDevPolicy(true, false).workspace, 'sibling-worktree');
  });
});

describe('change-dev Auto-Pilot: merge readiness', () => {
  const ok = { name: 'Build', status: 'completed', conclusion: 'success' };

  it('ready when every check succeeded and there is no conflict', () => {
    assert.equal(evaluateMergeReadiness(OPEN, [ok]).state, 'ready');
    assert.equal(
      evaluateMergeReadiness({ ...OPEN, mergeableState: 'behind' }, [ok]).state,
      'ready',
    );
  });

  it('pending while checks run or mergeability is unknown', () => {
    assert.equal(
      evaluateMergeReadiness(OPEN, [{ name: 'Build', status: 'in_progress', conclusion: null }])
        .state,
      'pending',
    );
    assert.equal(
      evaluateMergeReadiness({ ...OPEN, mergeableState: 'unknown' }, [ok]).state,
      'pending',
    );
  });

  it('blocked on a failed check, a conflict, or a closed / merged PR', () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required']) {
      const r = evaluateMergeReadiness(OPEN, [
        ok,
        { name: 'Test', status: 'completed', conclusion },
      ]);
      assert.equal(r.state, 'blocked', conclusion);
      assert.match(r.reasons[0], /Test/);
    }
    assert.equal(
      evaluateMergeReadiness({ ...OPEN, mergeableState: 'dirty' }, [ok]).state,
      'blocked',
    );
    assert.equal(evaluateMergeReadiness({ ...OPEN, merged: true }, [ok]).state, 'blocked');
    assert.equal(evaluateMergeReadiness({ ...OPEN, state: 'closed' }, [ok]).state, 'blocked');
  });

  it('a failed check is reported even while others still run', () => {
    const r = evaluateMergeReadiness(OPEN, [
      { name: 'Build', status: 'in_progress', conclusion: null },
      { name: 'Lint', status: 'completed', conclusion: 'failure' },
    ]);
    assert.equal(r.state, 'blocked');
  });

  it('recognises GitHub rejecting an approval by the PR author', () => {
    assert.equal(
      isSelfApprovalRejection(
        'gh: Unprocessable Entity (HTTP 422) Review Can not approve your own pull request',
      ),
      true,
    );
    assert.equal(isSelfApprovalRejection('HTTP 403: Resource not accessible'), false);
  });
});
