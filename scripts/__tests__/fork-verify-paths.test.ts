import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FORBIDDEN_PATHS, findTrackedLiveData } from '../fork-verify-paths.js';

describe('fork:verify live data paths', () => {
  it('detects tracked files under data/ledger/', () => {
    const tracked = [
      'README.md',
      'data/sample/dashboard.json',
      'data/ledger/2026-01/MANIFEST.json',
      'data/ledger/2026-01/activities.jsonl',
    ];
    assert.deepEqual(findTrackedLiveData(tracked), [
      'data/ledger/2026-01/MANIFEST.json',
      'data/ledger/2026-01/activities.jsonl',
    ]);
  });

  it('ignores .gitkeep placeholders and look-alike paths', () => {
    const tracked = ['data/ledger/.gitkeep', 'data/ledger-notes.md', 'docs/data/ledger/x.md'];
    assert.deepEqual(findTrackedLiveData(tracked), []);
  });

  it('keeps the existing live data paths', () => {
    for (const rel of ['data/snapshots', 'data/reports', 'data/state.json', 'data/ledger']) {
      assert.ok(FORBIDDEN_PATHS.includes(rel), rel);
    }
    assert.deepEqual(findTrackedLiveData(['data/state.json', 'data/snapshots/a/b.json']), [
      'data/state.json',
      'data/snapshots/a/b.json',
    ]);
  });

  it('is gitignored', () => {
    assert.match(readFileSync('.gitignore', 'utf8'), /^data\/ledger\/$/m);
  });
});
