import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  parseIdentityFile,
  parsePipelineKeyFile,
  type LedgerIdentity,
  type LedgerPipelineKey,
} from '../adapters/storage/ledger-crypto.js';
import { refuseOnUntrustedKeyHost } from '../infrastructure/key-host.js';
import type { Container } from './container.js';

/**
 * Option parsing and key files of the ledger key commands (#162 U8, #174 U9). Keys are read only
 * from files (never from an argument value or a variable other than `LEDGER_PIPELINE_KEY`), and
 * a key file is refused on CI and in a Claude Code cloud session.
 */

/** The value after `flag`; undefined when the flag is absent. */
export function valueOf(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function assertFlags(args: readonly string[], allowed: readonly string[]): void {
  const unknown = args.filter((a) => a.startsWith('--') && !allowed.includes(a));
  if (unknown.length > 0) throw new Error(`Unknown option(s): ${unknown.join(', ')}`);
}

/** Keys read from local files: recipient identities and pipeline-key backups (read only). */
export interface LocalLedgerKeys {
  readonly identities: readonly LedgerIdentity[];
  readonly readPipelineKeys: readonly LedgerPipelineKey[];
}

/** The key-file options, with the parser of each (registry, no switch). */
const KEY_FILE_OPTIONS = {
  '--identity': (content: string): Partial<LocalLedgerKeys> => ({
    identities: [parseIdentityFile(content)],
  }),
  '--pipeline-key': (content: string): Partial<LocalLedgerKeys> => ({
    readPipelineKeys: [parsePipelineKeyFile(content)],
  }),
} as const;

export const KEY_FILE_FLAGS = Object.keys(KEY_FILE_OPTIONS) as (keyof typeof KEY_FILE_OPTIONS)[];

/** True when `args` name a key file. */
export const namesKeyFile = (args: readonly string[]): boolean =>
  KEY_FILE_FLAGS.some((flag) => args.includes(flag));

/** Reads the key files `args` name; refuses an untrusted host before any file is opened. */
export async function localKeysOf(
  c: Container,
  args: readonly string[],
  action: string,
): Promise<LocalLedgerKeys> {
  const keys = { identities: [] as LedgerIdentity[], readPipelineKeys: [] as LedgerPipelineKey[] };
  if (!namesKeyFile(args)) return keys;
  refuseOnUntrustedKeyHost(c.env, action);
  for (const flag of KEY_FILE_FLAGS) {
    const path = valueOf(args, flag);
    if (!path) continue;
    const parsed = KEY_FILE_OPTIONS[flag](await readFile(resolve(c.env.baseDir, path), 'utf8'));
    keys.identities.push(...(parsed.identities ?? []));
    keys.readPipelineKeys.push(...(parsed.readPipelineKeys ?? []));
  }
  return keys;
}
