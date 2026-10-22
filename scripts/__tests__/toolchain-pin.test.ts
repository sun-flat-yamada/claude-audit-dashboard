import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Guards the Corepack pin (#150): every install, local or CI, runs the pnpm in
// `packageManager`, and CI takes Node from `.nvmrc`.

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  packageManager: string;
  engines: { node: string; pnpm: string };
};
const npmrc = readFileSync('.npmrc', 'utf8');
const setupAction = readFileSync('.github/actions/setup/action.yml', 'utf8');
const workflows = readdirSync('.github/workflows')
  .filter((f) => f.endsWith('.yml'))
  .map((f) => ({ name: f, text: readFileSync(`.github/workflows/${f}`, 'utf8') }));

const PACKAGE_MANAGER = /^pnpm@(\d+)\.(\d+)\.(\d+)\+sha512\.[0-9a-f]{128}$/;

describe('pnpm pin via Corepack', () => {
  it('packageManager pins an exact pnpm with its integrity hash', () => {
    assert.match(pkg.packageManager, PACKAGE_MANAGER);
  });

  it('engines.pnpm is a caret range that the pinned version satisfies', () => {
    const [, major, minor, patch] = PACKAGE_MANAGER.exec(pkg.packageManager) ?? [];
    assert.equal(pkg.engines.pnpm, `^${major}.${minor}.${patch}`);
  });

  it('.npmrc makes any other pnpm version refuse to run', () => {
    assert.match(npmrc, /^package-manager-strict-version=true$/m);
  });

  it('the setup action takes pnpm from packageManager and Node from .nvmrc', () => {
    assert.match(setupAction, /uses: pnpm\/action-setup@/);
    assert.doesNotMatch(setupAction, /^\s+version:/m);
    assert.match(setupAction, /node-version-file: \.nvmrc/);
    assert.doesNotMatch(setupAction, /node-version: /);
  });

  it('.nvmrc names a Node major that engines.node allows', () => {
    const nvmrc = readFileSync('.nvmrc', 'utf8').trim();
    const minMajor = /^>=(\d+)\./.exec(pkg.engines.node)?.[1];
    assert.ok(minMajor, `unexpected engines.node ${pkg.engines.node}`);
    assert.ok(Number(nvmrc.split('.')[0]) >= Number(minMajor), `.nvmrc ${nvmrc}`);
  });

  it('no workflow sets up pnpm or Node on its own', () => {
    for (const { name, text } of workflows) {
      assert.doesNotMatch(text, /pnpm\/action-setup|actions\/setup-node/, name);
      assert.doesNotMatch(text, /npm (i|install) (-g|--global) pnpm/, name);
    }
  });
});
