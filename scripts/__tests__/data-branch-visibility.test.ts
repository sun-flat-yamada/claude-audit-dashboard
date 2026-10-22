import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const script = resolve('.github/scripts/data-branch.sh');
const bashCmd =
  process.platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe')
    ? 'C:/Program Files/Git/bin/bash.exe'
    : 'bash';

const DATA_WRITING_WORKFLOWS = [
  'collect-audit.yml',
  'weekly-report.yml',
  'monthly-report.yml',
  'ack-alert.yml',
];

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

let root = '';
let n = 0;

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    {
      cwd,
      encoding: 'utf8',
      env: baseEnv(),
    },
  );
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function baseEnv(): Record<string, string> {
  return {
    PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
  };
}

/** A fresh clone with a bare `origin`, a commit on main and one data file. */
function makeRepo(): { clone: string; origin: string } {
  n += 1;
  const origin = join(root, `origin-${n}.git`);
  const clone = join(root, `clone-${n}`);
  git(root, 'init', '-q', '--bare', origin);
  git(root, 'init', '-q', '-b', 'main', clone);
  writeFileSync(join(clone, 'README.md'), 'test\n');
  git(clone, 'add', 'README.md');
  git(clone, 'commit', '-q', '-m', 'init');
  git(clone, 'remote', 'add', 'origin', origin);
  git(clone, 'push', '-q', 'origin', 'main');
  mkdirSync(join(clone, 'data'));
  writeFileSync(join(clone, 'data', 'state.json'), '{"synthetic":true}\n');
  return { clone, origin };
}

function run(cwd: string, args: string[], env: Record<string, string>): Run {
  const r = spawnSync(bashCmd, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...baseEnv(), ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function restoreAndSave(env: Record<string, string>): Run & { saved: boolean } {
  const { clone, origin } = makeRepo();
  const restored = run(clone, ['restore'], env);
  assert.equal(restored.status, 0, restored.stderr);
  const r = run(clone, ['save', 'chore: test data'], env);
  const heads = git(root, 'ls-remote', '--heads', origin, 'data/audit');
  return { ...r, saved: heads.includes('refs/heads/data/audit') };
}

/** A stub `gh` on PATH: prints STUB_VISIBILITY, or fails when it is unset. */
function writeGhStub(): void {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const stub = join(bin, 'gh');
  writeFileSync(
    stub,
    '#!/usr/bin/env bash\n[ -n "${STUB_VISIBILITY:-}" ] || exit 1\nprintf "%s\\n" "$STUB_VISIBILITY"\n',
  );
  chmodSync(stub, 0o755);
}

describe('data-branch.sh save: repository visibility guard', () => {
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'data-branch-'));
    writeFileSync(join(root, 'gitconfig'), '');
    writeGhStub();
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('refuses to save from a public repository', () => {
    const r = restoreAndSave({ REPOSITORY_VISIBILITY: 'public' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /::error::Refusing to save live audit data: this repository is public/);
    assert.equal(r.saved, false);
  });

  it('saves from a private or internal repository', () => {
    for (const visibility of ['private', 'internal']) {
      const r = restoreAndSave({ REPOSITORY_VISIBILITY: visibility });
      assert.equal(r.status, 0, `${visibility}: ${r.stderr}`);
      assert.equal(r.saved, true, visibility);
    }
  });

  it('treats an unset value outside GitHub Actions as a local run', () => {
    const r = restoreAndSave({});
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.saved, true);
  });

  it('refuses an unknown value without echoing it', () => {
    const r = restoreAndSave({ REPOSITORY_VISIBILITY: 'weird$(id)' });
    assert.notEqual(r.status, 0);
    assert.equal(r.saved, false);
    assert.ok(!r.stderr.includes('weird'));
  });

  it('inside GitHub Actions resolves an empty value with gh api and fails closed', () => {
    const actions = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'example/repo' };
    const pub = restoreAndSave({ ...actions, STUB_VISIBILITY: 'public' });
    assert.notEqual(pub.status, 0);
    assert.equal(pub.saved, false);
    const priv = restoreAndSave({ ...actions, STUB_VISIBILITY: 'private' });
    assert.equal(priv.status, 0, priv.stderr);
    assert.equal(priv.saved, true);
    const unknown = restoreAndSave(actions);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /could not determine the repository visibility/);
    assert.equal(unknown.saved, false);
  });

  it('is wired into every workflow that writes the data branch', () => {
    for (const name of DATA_WRITING_WORKFLOWS) {
      const workflow = readFileSync(join('.github/workflows', name), 'utf8');
      const step = workflow.slice(workflow.indexOf('.github/scripts/data-branch.sh save'));
      const nextStep = step.indexOf('\n      - ');
      const body = nextStep === -1 ? step : step.slice(0, nextStep);
      assert.match(
        body,
        /REPOSITORY_VISIBILITY: \$\{\{ github\.event\.repository\.visibility \}\}/,
        name,
      );
      assert.match(body, /GH_TOKEN: \$\{\{ github\.token \}\}/, name);
    }
  });
});
