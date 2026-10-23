import { describe, expect, it } from 'vitest';
import { readEnvironment } from '../env.js';
import { refuseOnUntrustedKeyHost, untrustedKeyHost } from '../key-host.js';

// The environment is always passed in: these tests behave the same locally, on CI and in a
// Claude Code cloud session, whatever process.env holds.
const env = (vars: Record<string, string>) => readEnvironment(vars, '/work');

describe('untrustedKeyHost (#174 U9)', () => {
  it('is null on an operator machine', () => {
    expect(untrustedKeyHost(env({}))).toBeNull();
    expect(untrustedKeyHost(env({ CI: 'false', CLAUDE_CODE_REMOTE: 'false' }))).toBeNull();
    expect(untrustedKeyHost(env({ CI: '', CLAUDE_CODE_REMOTE: ' ' }))).toBeNull();
  });

  it('names CI and a Claude Code cloud session', () => {
    expect(untrustedKeyHost(env({ CI: 'true' }))).toBe('CI');
    expect(untrustedKeyHost(env({ CI: '1' }))).toBe('CI');
    expect(untrustedKeyHost(env({ CLAUDE_CODE_REMOTE: 'true' }))).toBe(
      'a Claude Code cloud session',
    );
    expect(untrustedKeyHost(env({ CLAUDE_CODE_REMOTE: 'TRUE' }))).toBe(
      'a Claude Code cloud session',
    );
  });

  it('throws a message that names the action and the host only', () => {
    expect(() => refuseOnUntrustedKeyHost(env({}), 'decrypt')).not.toThrow();
    expect(() => refuseOnUntrustedKeyHost(env({ CLAUDE_CODE_REMOTE: 'true' }), 'decrypt')).toThrow(
      /^ledger decrypt refuses to run on a Claude Code cloud session: /,
    );
  });
});
