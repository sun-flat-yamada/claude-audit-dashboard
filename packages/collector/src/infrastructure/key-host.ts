import type { Environment } from './env.js';

/**
 * Hosts on which ledger private keys, pipeline-key files and decrypted ledger content must never
 * be handled (#174 U9): machines that are shared, logged or discarded and operated by automation.
 * Read from the injected `Environment` (never `process.env` directly), so tests decide the host.
 */
type HostSettings = Pick<Environment, 'ci' | 'claudeCodeRemote'>;

const isTrue = (value: string | undefined): boolean => {
  const v = value?.trim().toLowerCase();
  return v === 'true' || v === '1';
};

/** One entry per untrusted host (registry, no switch); add a host by adding an entry. */
const UNTRUSTED_KEY_HOSTS: readonly { name: string; matches: (env: HostSettings) => boolean }[] = [
  { name: 'CI', matches: (env) => isTrue(env.ci) },
  { name: 'a Claude Code cloud session', matches: (env) => isTrue(env.claudeCodeRemote) },
];

/** The name of the untrusted host this process runs on, or `null` on an operator's machine. */
export const untrustedKeyHost = (env: HostSettings): string | null =>
  UNTRUSTED_KEY_HOSTS.find((host) => host.matches(env))?.name ?? null;

/** Throws when `action` would handle key material or plaintext on an untrusted host. */
export function refuseOnUntrustedKeyHost(env: HostSettings, action: string): void {
  const host = untrustedKeyHost(env);
  if (host)
    throw new Error(
      `ledger ${action} refuses to run on ${host}: private keys, key backups and decrypted data stay on your own machine`,
    );
}
