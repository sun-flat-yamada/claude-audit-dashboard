import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PACKAGE_FILES,
  RELEASE_TAG,
  blueprintStatus,
  checkReleaseIntegrity,
  checkTagMatchesVersions,
  extractChangelogSection,
  prepareRelease,
  readInputs,
  unreleasedEntries,
  type ReleaseInputs,
} from '../release-integrity.js';

function versions(v: string): Record<string, string> {
  return Object.fromEntries(PACKAGE_FILES.map((f) => [f, v]));
}

const CHANGELOG_1 = `# Changelog

## [Unreleased]

## [1.0.0] - 2027-01-15

### Added

- Everything.

## [0.2.0] - 2026-10-01

### Added

- Old.
`;

function inputs(over: Partial<ReleaseInputs> = {}): ReleaseInputs {
  return {
    versions: versions('1.0.0'),
    changelog: CHANGELOG_1,
    blueprint: '> **Status:** Stable\n',
    ...over,
  };
}

describe('release integrity of this repository', () => {
  it('passes now (pre-1.0 metadata is consistent)', () => {
    const result = checkReleaseIntegrity(readInputs(process.cwd()));
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  });
});

describe('checkReleaseIntegrity: version consistency', () => {
  it('fails when one package.json differs', () => {
    const v = { ...versions('0.2.0'), 'packages/core/package.json': '0.3.0' };
    const r = checkReleaseIntegrity({ ...inputs(), versions: v, changelog: '## [Unreleased]\n' });
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /versions differ/);
  });

  it('fails on a missing or non X.Y.Z version', () => {
    const v: Record<string, string | undefined> = versions('0.2.0');
    delete v['packages/dashboard/package.json'];
    v['package.json'] = 'latest';
    const r = checkReleaseIntegrity({ ...inputs(), versions: v });
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /no "version" field/);
    assert.match(r.errors.join('\n'), /not X\.Y\.Z/);
  });
});

describe('checkReleaseIntegrity: 0.x', () => {
  it('accepts an [Unreleased] section or the matching heading, Draft status included', () => {
    const draft = '> **Status:** Draft\n';
    assert.equal(
      checkReleaseIntegrity({
        versions: versions('0.2.0'),
        changelog: '## [Unreleased]\n\n- x\n',
        blueprint: draft,
      }).ok,
      true,
    );
    assert.equal(
      checkReleaseIntegrity({
        versions: versions('0.2.0'),
        changelog: '## [0.2.0] - 2026-10-01\n',
        blueprint: draft,
      }).ok,
      true,
    );
  });

  it('fails without any suitable CHANGELOG section', () => {
    const r = checkReleaseIntegrity({
      versions: versions('0.2.0'),
      changelog: '## [0.1.0] - 2026-01-01\n',
      blueprint: '',
    });
    assert.equal(r.ok, false);
  });
});

describe('checkReleaseIntegrity: 1.0.0 and later', () => {
  it('passes for a complete release', () => {
    assert.deepEqual(checkReleaseIntegrity(inputs()).errors, []);
  });

  it('fails when the dated heading is missing', () => {
    const r = checkReleaseIntegrity(
      inputs({ changelog: CHANGELOG_1.replace('[1.0.0]', '[0.9.0]') }),
    );
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /no "## \[1\.0\.0\] - yyyy-mm-dd" heading/);
  });

  it('fails when the heading has no valid date', () => {
    for (const bad of ['TBD', '2027-13-45', '2027-02-30']) {
      const r = checkReleaseIntegrity(
        inputs({ changelog: CHANGELOG_1.replace('2027-01-15', bad) }),
      );
      assert.equal(r.ok, false, bad);
      assert.match(r.errors.join('\n'), /valid date/);
    }
  });

  it('fails when [Unreleased] still holds entries', () => {
    const r = checkReleaseIntegrity(
      inputs({
        changelog: CHANGELOG_1.replace(
          '## [Unreleased]\n',
          '## [Unreleased]\n\n### Added\n\n- Leftover item.\n',
        ),
      }),
    );
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /\[Unreleased\] still holds 1 line/);
  });

  it('allows empty sub-headings under [Unreleased]', () => {
    const changelog = CHANGELOG_1.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Added\n');
    assert.deepEqual(unreleasedEntries(changelog), []);
    assert.equal(checkReleaseIntegrity(inputs({ changelog })).ok, true);
  });

  it('fails when the BLUEPRINT status is not Stable', () => {
    for (const status of ['Draft — Phase B pending', 'Stable-ish?', '']) {
      const r = checkReleaseIntegrity(inputs({ blueprint: `> **Status:** ${status}\n` }));
      assert.equal(r.ok, false, status);
      assert.match(r.errors.join('\n'), /expected Stable/);
    }
    assert.equal(checkReleaseIntegrity(inputs({ blueprint: 'no status line' })).ok, false);
  });

  it('reports every problem at once', () => {
    const r = checkReleaseIntegrity({
      versions: versions('1.0.0'),
      changelog: '## [Unreleased]\n\n- x\n',
      blueprint: '> **Status:** Draft\n',
    });
    assert.equal(r.errors.length, 3);
  });
});

describe('blueprintStatus', () => {
  it('reads the Status line of the real blueprint', () => {
    const status = blueprintStatus(readFileSync('docs/BLUEPRINT.md', 'utf8'));
    assert.ok(status && status.length > 0);
  });
});

describe('tag against package versions', () => {
  it('matches vX.Y.Z to X.Y.Z of all four files', () => {
    const r = checkTagMatchesVersions('v1.0.0', versions('1.0.0'));
    assert.deepEqual([r.ok, r.version], [true, '1.0.0']);
  });

  it('names every file that does not match', () => {
    const v = { ...versions('1.0.0'), 'packages/collector/package.json': '0.9.0' };
    const r = checkTagMatchesVersions('v1.0.0', v);
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0] ?? '', /packages\/collector\/package\.json/);
  });

  it('accepts only the strict tag shape', () => {
    for (const bad of [
      '1.0.0',
      'v1.0',
      'v1.0.0-rc.1',
      'v01.0.0',
      'v1.0.0\n',
      'v1.0.0 ',
      'vx',
      '',
    ]) {
      assert.equal(RELEASE_TAG.test(bad), false, JSON.stringify(bad));
      assert.equal(checkTagMatchesVersions(bad, versions('1.0.0')).ok, false);
    }
  });
});

describe('release notes extraction', () => {
  it('returns the body of the matching section only', () => {
    const notes = extractChangelogSection(CHANGELOG_1, '1.0.0');
    assert.equal(notes, '### Added\n\n- Everything.');
    assert.equal(extractChangelogSection(CHANGELOG_1, '0.2.0'), '### Added\n\n- Old.');
  });

  it('returns undefined for an unknown or empty section and drops trailing link references', () => {
    assert.equal(extractChangelogSection(CHANGELOG_1, '2.0.0'), undefined);
    assert.equal(extractChangelogSection('## [1.0.0] - 2027-01-15\n\n', '1.0.0'), undefined);
    const withRefs = '## [1.0.0] - 2027-01-15\n\n- a\n\n[1.0.0]: https://example.com/r\n';
    assert.equal(extractChangelogSection(withRefs, '1.0.0'), '- a');
  });

  it('does not confuse 1.0.0 with 1.0.01 style prefixes', () => {
    assert.equal(extractChangelogSection('## [1.0.00] - 2027-01-15\n- a\n', '1.0.0'), undefined);
  });

  it('prepareRelease returns the notes only when tag, versions and CHANGELOG all agree', () => {
    const ok = prepareRelease('v1.0.0', inputs());
    assert.equal(ok.ok, true);
    assert.equal(ok.notes, '### Added\n\n- Everything.');
    assert.equal(prepareRelease('v1.0.1', inputs()).ok, false);
    assert.equal(prepareRelease('v1.0.0', inputs({ changelog: '## [Unreleased]\n' })).ok, false);
  });

  it('prepareRelease needs a dated heading even before 1.0.0', () => {
    const pre: ReleaseInputs = {
      versions: versions('0.3.0'),
      changelog: '## [Unreleased]\n\n- x\n',
      blueprint: '> **Status:** Draft\n',
    };
    assert.equal(checkReleaseIntegrity(pre).ok, true);
    assert.equal(prepareRelease('v0.3.0', pre).ok, false);
    const released = { ...pre, changelog: '## [Unreleased]\n\n## [0.3.0] - 2026-11-01\n\n- x\n' };
    assert.equal(prepareRelease('v0.3.0', released).notes, '- x');
  });
});

describe('release.yml guard', () => {
  const wf = readFileSync('.github/workflows/release.yml', 'utf8');
  const releaseJob = wf.slice(wf.indexOf('\n  release:'));
  const verifyJob = wf.slice(wf.indexOf('\n  verify:'), wf.indexOf('\n  release:'));

  it('is triggered only by v* tag pushes and never by pull_request_target', () => {
    assert.match(wf, /on:\n {2}push:\n {4}tags: \['v\*'\]\n/);
    assert.ok(!wf.includes('pull_request'));
    assert.ok(!wf.includes('workflow_dispatch'));
  });

  it('is read-only by default and grants contents: write to the release job only', () => {
    assert.match(wf, /\npermissions:\n {2}contents: read\n/);
    assert.equal(wf.match(/contents: write/g)?.length, 1);
    assert.ok(releaseJob.includes('contents: write'));
    assert.ok(!verifyJob.includes('contents: write'));
  });

  it('runs verify:all and the tag check before the release job, which needs verify', () => {
    assert.ok(verifyJob.includes('run: pnpm verify:all'));
    assert.ok(verifyJob.includes('pnpm release:check --tag "$TAG"'));
    assert.ok(verifyJob.includes('playwright install --with-deps chromium'));
    assert.match(releaseJob, /needs: verify/);
    assert.ok(releaseJob.includes('gh release create'));
    assert.ok(!verifyJob.includes('gh release'));
  });

  it('passes the tag through the environment, validates it strictly and never inlines it in a script', () => {
    const lines = wf.split('\n').filter((l) => l.includes('${{'));
    for (const l of lines) {
      assert.ok(
        !/^\s+run:/.test(l) && !l.includes('github.event') && !l.includes('github.head_ref'),
        `expression in a run line: ${l}`,
      );
    }
    assert.match(wf, /TAG: \$\{\{ github\.ref_name \}\}/);
    assert.equal(wf.match(/\^v\(0\|\[1-9\]\[0-9\]\*\)/g)?.length, 2);
    assert.ok(!/echo .*secrets\./.test(wf));
  });

  it('serialises runs per tag without cancelling', () => {
    assert.match(
      wf,
      /concurrency:\n {2}group: release-\$\{\{ github\.ref_name \}\}\n {2}cancel-in-progress: false/,
    );
  });
});
