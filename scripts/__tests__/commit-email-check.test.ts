import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  emailFromIdent,
  findEmailIssues,
  isAllowedEmail,
  maskEmail,
  parseArgs,
  parseGitLog,
  parseTrailers,
  readCommits,
  type CommitIdentity,
} from '../commit-email-check.js';

// Synthetic identities only: reserved `.example` / `.test` domains (RFC 2606).
const OWNER = '51235130+sun-flat-yamada@users.noreply.github.com';
const PERSONAL = 'jane.doe@corp.example';
const AGENT_TRAILER = 'Co-Authored-By: Claude <noreply@anthropic.com>';

function commit(over: Partial<CommitIdentity> = {}): CommitIdentity {
  return {
    sha: 'a'.repeat(40),
    authorEmail: OWNER,
    committerEmail: OWNER,
    message: `feat: something\n\n${AGENT_TRAILER}\n`,
    ...over,
  };
}

describe('commit e-mail allowlist', () => {
  it('accepts GitHub noreply, GitHub web-flow and the Claude Code agent address', () => {
    for (const email of [
      OWNER,
      'octocat@users.noreply.github.com',
      '49699333+dependabot[bot]@users.noreply.github.com',
      '41898282+github-actions[bot]@users.noreply.github.com',
      'noreply@github.com',
      'noreply@anthropic.com',
      'NoReply@Anthropic.com',
    ]) {
      assert.ok(isAllowedEmail(email), email);
    }
  });

  it('refuses personal, corporate and look-alike addresses', () => {
    for (const email of [
      PERSONAL,
      'someone@mail.test',
      'support@github.com',
      'noreply@users.noreply.github.com.evil.test',
      'x@noreply.github.com',
      'name <noreply@anthropic.com>',
      '',
    ]) {
      assert.ok(!isAllowedEmail(email), email);
    }
  });
});

describe('maskEmail', () => {
  it('keeps one character of the local part and the domain, and the top-level label', () => {
    assert.equal(maskEmail(PERSONAL), 'j***@c***.example');
    assert.equal(maskEmail('a@b'), 'a***@b***');
    assert.equal(maskEmail(''), '***');
    assert.equal(maskEmail('not-an-address'), '***');
    assert.ok(!maskEmail(PERSONAL).includes('doe'));
  });
});

describe('findEmailIssues', () => {
  it('passes a clean commit', () => {
    assert.deepEqual(findEmailIssues(commit()), []);
  });

  it('reports the author and the committer separately, masked', () => {
    const issues = findEmailIssues(commit({ authorEmail: PERSONAL, committerEmail: PERSONAL }));
    assert.deepEqual(
      issues.map((i) => [i.field, i.masked]),
      [
        ['author', 'j***@c***.example'],
        ['committer', 'j***@c***.example'],
      ],
    );
  });

  it('reports every *-by: trailer that is not noreply, whatever its case', () => {
    const message = `fix: x\n\nCo-authored-by: Jane <${PERSONAL}>\nReviewed-by: Bob <bob@mail.test>\n${AGENT_TRAILER}\n`;
    assert.deepEqual(
      findEmailIssues(commit({ message })).map((i) => i.field),
      ['trailer Co-authored-by', 'trailer Reviewed-by'],
    );
  });

  it("accepts Dependabot's sign-off only with its exact name and only as a trailer", () => {
    const signoff = 'Signed-off-by: dependabot[bot] <support@github.com>';
    assert.deepEqual(findEmailIssues(commit({ message: `chore(deps): bump\n\n${signoff}\n` })), []);
    const other = 'Signed-off-by: Jane <support@github.com>';
    assert.equal(findEmailIssues(commit({ message: `chore: x\n\n${other}\n` })).length, 1);
    assert.equal(findEmailIssues(commit({ authorEmail: 'support@github.com' })).length, 1);
  });

  it('reports addresses in the message text but accepts reserved example domains and versions', () => {
    const message =
      'docs: contact someone@mail.test\n\nSample user_alice@example.com, a@sub.example.org, pnpm@9.15.4, @types/node@26.6.5\n';
    assert.deepEqual(
      findEmailIssues(commit({ message })).map((i) => [i.field, i.masked]),
      [['message', 's***@m***.test']],
    );
  });
});

describe('parsing', () => {
  it('parses trailers with a name and an address', () => {
    assert.deepEqual(parseTrailers(`x\n\n${AGENT_TRAILER}\nClaude-Session: https://x.test\n`), [
      { key: 'Co-Authored-By', name: 'Claude', email: 'noreply@anthropic.com' },
    ]);
  });

  it('parses git log records with multi-line messages', () => {
    const out = `${'a'.repeat(40)}\x1fa@x.test\x1fc@x.test\x1fline 1\n\nline 3\n\x1e\n${'b'.repeat(40)}\x1fb@x.test\x1fb@x.test\x1fsecond\n\x1e\n`;
    const commits = parseGitLog(out);
    assert.equal(commits.length, 2);
    assert.equal(commits[0].message, 'line 1\n\nline 3\n');
    assert.equal(commits[1].sha, 'b'.repeat(40));
    assert.equal(commits[1].committerEmail, 'b@x.test');
  });

  it('reads the address of a git ident line', () => {
    assert.equal(
      emailFromIdent(`Claude <noreply@anthropic.com> 1700000000 +0000`),
      'noreply@anthropic.com',
    );
    assert.equal(emailFromIdent('broken'), '');
  });

  it('parses the CLI arguments', () => {
    assert.deepEqual(parseArgs([]), { revisions: ['origin/main..HEAD'] });
    assert.deepEqual(parseArgs(['--range', 'a..b']), { revisions: ['a..b'] });
    assert.deepEqual(parseArgs(['--', 'abc', '--not', '--remotes=origin']), {
      revisions: ['abc', '--not', '--remotes=origin'],
    });
    assert.deepEqual(parseArgs(['--message-file', 'MSG']), { revisions: [], messageFile: 'MSG' });
  });
});

describe('commit e-mail check on a git repository (integration)', () => {
  const skip = process.platform === 'win32' ? 'symlinked hooks need a POSIX shell' : false;
  let root = '';

  function run(cmd: string, args: string[], env: Record<string, string> = {}) {
    return spawnSync(cmd, args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: join(root, '.gitconfig-test'),
        ...env,
      },
    });
  }

  function commitAs(email: string, message: string) {
    return run('git', [
      '-c',
      'user.name=Test',
      '-c',
      `user.email=${email}`,
      'commit',
      '--allow-empty',
      '-q',
      '-m',
      message,
    ]);
  }

  before(() => {
    if (skip) return;
    root = mkdtempSync(join(tmpdir(), 'commit-email-'));
    writeFileSync(join(root, '.gitconfig-test'), '');
    assert.equal(run('git', ['init', '-q', '-b', 'main']).status, 0);
    mkdirSync(join(root, 'scripts'));
    // A copy, not a link: the script runs its CLI only when started as itself.
    copyFileSync(
      resolve('scripts/commit-email-check.ts'),
      join(root, 'scripts/commit-email-check.ts'),
    );
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'));
    symlinkSync(resolve('.githooks'), join(root, '.githooks'));
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('reads the author, committer and message of a range', { skip }, () => {
    assert.equal(commitAs(OWNER, 'feat: clean').status, 0);
    assert.equal(commitAs(PERSONAL, `fix: leak\n\nCo-Authored-By: Bob <bob@mail.test>`).status, 0);
    const issues = readCommits(root, ['HEAD']).flatMap(findEmailIssues);
    assert.deepEqual(
      issues.map((i) => i.field),
      ['author', 'committer', 'trailer Co-Authored-By'],
    );
  });

  it('the CLI fails with masked output only', { skip }, () => {
    const r = run(resolve('node_modules/.bin/tsx'), [
      resolve('scripts/commit-email-check.ts'),
      '--',
      'HEAD',
    ]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /author: j\*\*\*@c\*\*\*\.example is not a noreply address/);
    assert.ok(!`${r.stdout}${r.stderr}`.includes(PERSONAL));
    assert.ok(!`${r.stdout}${r.stderr}`.includes('bob@mail.test'));
  });

  it('the commit-msg hook refuses a personal identity and a personal trailer', { skip }, () => {
    assert.equal(run('git', ['config', 'core.hooksPath', '.githooks']).status, 0);
    const refused = commitAs(PERSONAL, 'feat: refused');
    assert.notEqual(refused.status, 0);
    assert.ok(!refused.stderr.includes(PERSONAL));
    assert.notEqual(commitAs(OWNER, `feat: x\n\nCo-Authored-By: Jane <${PERSONAL}>`).status, 0);
    assert.equal(commitAs(OWNER, `feat: allowed\n\n${AGENT_TRAILER}`).status, 0);
  });

  it('the pre-push hook checks new branches and ranges past the remote tip', { skip }, () => {
    const remote = join(root, 'remote.git');
    assert.equal(run('git', ['init', '-q', '--bare', remote]).status, 0);
    assert.equal(run('git', ['remote', 'add', 'origin', remote]).status, 0);
    // History: clean (HEAD~2) <- leak (HEAD~1) <- allowed (HEAD).
    const newBranch = run('git', ['push', '-q', 'origin', 'main']);
    assert.notEqual(newBranch.status, 0);
    assert.match(newBranch.stderr, /author: j\*\*\*@c\*\*\*\.example/);
    assert.ok(!newBranch.stderr.includes(PERSONAL));
    assert.equal(run('git', ['push', '-q', 'origin', 'HEAD~2:refs/heads/main']).status, 0);
    const range = run('git', ['push', '-q', 'origin', 'main']);
    assert.notEqual(range.status, 0);
    assert.match(range.stderr, /3 non-noreply/);
  });

  it('the hooks are executable POSIX scripts', { skip }, () => {
    for (const hook of ['commit-msg', 'pre-push']) {
      assert.match(readFileSync(resolve('.githooks', hook), 'utf8'), /^#!\/bin\/sh\n/);
      assert.equal(run('test', ['-x', resolve('.githooks', hook)]).status, 0, hook);
    }
  });
});

describe('Commit E-mail Check workflow', () => {
  const wf = readFileSync(resolve('.github/workflows/commit-email.yml'), 'utf8');

  it('runs for every pull request (forks included) and pushes to main', () => {
    assert.match(wf, /pull_request:\n\s+types: \[opened, reopened, synchronize\]/);
    assert.match(wf, /push:\n\s+branches: \[main\]/);
    assert.ok(!/head\.repo\.full_name/.test(wf), 'must not skip fork pull requests');
  });

  it('fetches the whole history, reads only and passes SHAs through the environment', () => {
    assert.match(wf, /fetch-depth: 0/);
    assert.match(wf, /permissions:\n\s+contents: read/);
    assert.match(wf, /pnpm commit-email:check --range "\$PR_BASE\.\.\$PR_HEAD"/);
    assert.match(wf, /pnpm commit-email:check --range "\$PUSH_BEFORE\.\.\$PUSH_AFTER"/);
    assert.ok(!/run: .*\$\{\{/.test(wf), 'no expression inside a run line');
    assert.match(wf, /name: Commit e-mails are noreply/);
  });
});
