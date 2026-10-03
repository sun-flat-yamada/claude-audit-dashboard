import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildBranchName,
  isCloudDefaultBranch,
  parseConventionalTitle,
  slugify,
  specFromArgs,
  validateBranchName,
} from '../change-dev-branch.js';

describe('change-dev branch naming', () => {
  it('builds <type>/<issue>-<slug> from a title', () => {
    assert.equal(
      buildBranchName({ type: 'feat', issue: 42, title: 'Add cost center export' }),
      'feat/42-add-cost-center-export',
    );
  });

  it('builds <type>/<slug> without an Issue', () => {
    assert.equal(
      buildBranchName({ type: 'docs', title: 'Fix typo in README' }),
      'docs/fix-typo-in-readme',
    );
  });

  it('slugifies to lowercase ASCII words, drops articles and cuts at a word boundary', () => {
    assert.equal(
      slugify('Café: the "User-Agent" header (GA 2022-11-28)!'),
      'cafe-user-agent-header-ga-2022-11-28',
    );
    const long = slugify(
      'name cloud session branches after the change they carry and nothing else at all',
    );
    assert.ok(long.length <= 40, long);
    assert.ok(!long.endsWith('-'));
    assert.equal(long, 'name-cloud-session-branches-after-change');
  });

  it('refuses a title without ASCII words unless a slug is given', () => {
    assert.throws(
      () => buildBranchName({ type: 'fix', issue: 7, title: 'ブランチ名の修正' }),
      /--slug/,
    );
    assert.equal(
      buildBranchName({ type: 'fix', issue: 7, title: 'ブランチ名の修正', slug: 'branch-name' }),
      'fix/7-branch-name',
    );
  });

  it('rejects unknown types', () => {
    assert.throws(() => buildBranchName({ type: 'feature', title: 'x y z' }), /unknown type/);
  });

  it('parses Conventional Commits and Work-Unit Issue titles', () => {
    assert.deepEqual(parseConventionalTitle('feat(change-dev): name branches'), {
      type: 'feat',
      text: 'name branches',
    });
    assert.deepEqual(parseConventionalTitle('fix!: drop x'), { type: 'fix', text: 'drop x' });
    assert.deepEqual(parseConventionalTitle('[P3-1] Metric catalog v1'), {
      type: null,
      text: 'Metric catalog v1',
    });
  });

  it('reads positional arguments and options; takes type and title from the Issue when omitted', () => {
    assert.deepEqual(specFromArgs(['fix', '43', 'Prorate', 'calc']), {
      type: 'fix',
      issue: 43,
      slug: undefined,
      title: 'Prorate calc',
    });
    assert.deepEqual(specFromArgs(['docs', '-', 'Readme']), {
      type: 'docs',
      issue: null,
      slug: undefined,
      title: 'Readme',
    });
    const spec = specFromArgs(
      ['--issue', '#242'],
      () => 'feat(change-dev): name cloud session branches',
    );
    assert.equal(buildBranchName(spec), 'feat/242-name-cloud-session-branches');
    assert.throws(() => specFromArgs(['--issue', '9'], () => '[P1-2] Something'), /change type/);
  });
});

describe('change-dev branch validation', () => {
  it('accepts the convention', () => {
    for (const b of [
      'feat/42-cost-center-export',
      'fix/deep-analysis-user-controls',
      'refactor/110-rename-cost-allocation',
    ]) {
      assert.equal(validateBranchName(b).status, 'ok', b);
    }
  });

  it('flags the Claude Code cloud default names', () => {
    for (const b of ['claude/quirky-cray-71fqmx', 'ccr-4c21179f-3zdi34']) {
      assert.equal(isCloudDefaultBranch(b), true, b);
      const r = validateBranchName(b);
      assert.equal(r.status, 'invalid');
      assert.match(r.reasons[0], /cloud platform assigned/);
    }
  });

  it('rejects other non-descriptive or malformed names', () => {
    for (const b of [
      'feature/42-x',
      'feat/42',
      'feat/42-ab',
      'Feat/42-Add-Thing',
      'feat/42--double',
      'my-branch',
      'feat/1-' + 'a'.repeat(41),
    ]) {
      assert.equal(validateBranchName(b).status, 'invalid', b);
    }
  });

  it('exempts long-lived and bot branches', () => {
    for (const b of [
      'main',
      'data/audit',
      'fork/custom',
      'dependabot/npm_and_yarn/vite-1a5240e55e',
    ]) {
      assert.equal(validateBranchName(b).status, 'exempt', b);
    }
  });
});
