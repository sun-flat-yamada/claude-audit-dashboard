import { createHash } from 'node:crypto';

/**
 * Turns captured API responses into shareable, shape-only fixtures.
 *
 * - e-mail addresses -> `userN@example.com`
 * - prefixed IDs (`user_01Abc...`) and UUIDs -> deterministic synthetic IDs with the same prefix,
 *   length and character classes; the same real ID always maps to the same synthetic ID, in every
 *   file handled by one `Sanitizer`, so cross references (Activity `api_key_id` vs. the key
 *   inventory `id`) survive
 * - user / group / organization / key names -> `Synthetic <Kind> N`
 * - IP addresses -> `192.0.2.0/24` (IPv6: `2001:db8::/32`)
 * - free-text descriptions and user agents are blanked, key-like strings are redacted
 *
 * Pure: no I/O. The mapping is a function of the input and the salt only.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** `snake_prefix_` + one alphanumeric segment with at least one digit (plain enums have none). */
const PREFIXED_ID = /\b((?:[a-z]+_)+)([A-Za-z0-9]*\d[A-Za-z0-9]*)\b/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const KEY_LIKE = /sk-ant-[A-Za-z0-9_-]+/g;

const NAME_KEYS = new Set(['name', 'display_name', 'full_name', 'organization_name', 'group_name']);
const IP_KEYS = new Set(['ip_address', 'ip']);
/** Free text and fingerprints are replaced wholesale. */
const FIXED_FIELDS = new Map([
  ['description', 'Synthetic description'],
  ['user_agent', 'synthetic-agent/1.0'],
]);
const DOC_NET = '192.0.2.';

export const DEFAULT_SALT = 'claude-audit-sanitizer-v1';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Stream of pseudo-random bytes derived from `seed` (sha256 in counter mode). */
function bytesFor(seed: string, length: number): Buffer {
  const blocks: Buffer[] = [];
  for (let i = 0; blocks.length * 32 < length; i++) {
    blocks.push(createHash('sha256').update(`${seed}:${i}`).digest());
  }
  return Buffer.concat(blocks).subarray(0, length);
}

/** Same length, same character class at every position (digit / upper / lower). */
function shaped(real: string, bytes: Buffer): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return [...real]
    .map((char, i) => {
      const n = bytes[i] ?? 0;
      if (/\d/.test(char)) return String(n % 10);
      if (/[A-Z]/.test(char)) return upper[n % 26] ?? 'A';
      if (/[a-z]/.test(char)) return upper[n % 26]?.toLowerCase() ?? 'a';
      return char;
    })
    .join('');
}

function shapedUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  const variant = (parseInt(hex[16] ?? '0', 16) & 3) + 8;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant.toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

export interface SanitizeStats {
  emails: number;
  ids: number;
  names: number;
  ips: number;
}

export class Sanitizer {
  private readonly emails = new Map<string, string>();
  private readonly ids = new Map<string, string>();
  private readonly names = new Map<string, string>();
  private readonly nameCounters = new Map<string, number>();
  private readonly ips = new Map<string, string>();
  private readonly ipv6 = new Map<string, string>();
  private readonly produced = new Set<string>();

  constructor(private readonly salt: string = DEFAULT_SALT) {}

  /** Returns a sanitized deep copy of `value` (objects, arrays and strings are rewritten). */
  sanitize<T>(value: T): T {
    return this.walk(value, '', undefined) as T;
  }

  stats(): SanitizeStats {
    return {
      emails: this.emails.size,
      ids: this.ids.size,
      names: this.names.size,
      ips: this.ips.size + this.ipv6.size,
    };
  }

  /**
   * Original values that still occur in `output` (a serialized sanitized document). An empty
   * result means no replaced value survived. Names are matched as whole JSON strings only.
   */
  residue(output: string): string[] {
    const found: string[] = [];
    const check = (real: string, needle: string): void => {
      if (!this.produced.has(real) && output.includes(needle)) found.push(real);
    };
    for (const real of [...this.emails.keys(), ...this.ids.keys()]) check(real, real);
    for (const real of [...this.ips.keys(), ...this.ipv6.keys()]) check(real, real);
    for (const key of this.names.keys()) {
      const real = key.slice(key.indexOf('|') + 1);
      check(real, JSON.stringify(real));
    }
    return found;
  }

  private walk(value: unknown, key: string, parent: Json | undefined): unknown {
    if (typeof value === 'string') return this.field(value, key, parent);
    if (Array.isArray(value)) return value.map((item) => this.walk(item, key, parent));
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [this.text(k), this.walk(v, k, value)]),
    );
  }

  /** Field-aware rules first (names, free text, IPv6), then pattern-based text replacement. */
  private field(value: string, key: string, parent: Json | undefined): string {
    const fixed = FIXED_FIELDS.get(key);
    if (fixed !== undefined && value !== '') return fixed;
    if (IP_KEYS.has(key) && value.includes(':')) return this.ipv6For(value);
    if (parent && NAME_KEYS.has(key) && !isSettingRow(parent)) {
      return this.nameFor(value, kindOf(parent));
    }
    return this.text(value);
  }

  private text(value: string): string {
    return value
      .replace(KEY_LIKE, 'REDACTED_KEY')
      .replace(EMAIL, (m) => this.emailFor(m))
      .replace(UUID, (m) => this.idFor(m, '', m))
      .replace(PREFIXED_ID, (m, prefix: string, body: string) => this.idFor(m, prefix, body))
      .replace(IPV4, (m) => this.ipFor(m));
  }

  private remember(map: Map<string, string>, real: string, synthetic: string): string {
    map.set(real, synthetic);
    this.produced.add(synthetic);
    return synthetic;
  }

  private emailFor(email: string): string {
    const known = this.emails.get(email.toLowerCase());
    return (
      known ??
      this.remember(this.emails, email.toLowerCase(), `user${this.emails.size + 1}@example.com`)
    );
  }

  /** Deterministic, injective within one sanitizer: a clash re-hashes with the next attempt number. */
  private idFor(real: string, prefix: string, body: string): string {
    const known = this.ids.get(real);
    if (known) return known;
    for (let attempt = 0; ; attempt++) {
      const bytes = bytesFor(`${this.salt}|${real}|${attempt}`, Math.max(body.length, 16));
      const candidate = prefix ? `${prefix}${shaped(body, bytes)}` : shapedUuid(bytes);
      if (candidate !== real && !this.produced.has(candidate)) {
        return this.remember(this.ids, real, candidate);
      }
    }
  }

  private ipFor(ip: string): string {
    const known = this.ips.get(ip);
    if (known) return known;
    if (ip.split('.').some((octet) => Number(octet) > 255)) return ip;
    const seed = bytesFor(`${this.salt}|ip|${ip}`, 1)[0] ?? 0;
    for (let i = 0; i < 254; i++) {
      const candidate = `${DOC_NET}${((seed + i) % 254) + 1}`;
      if (!this.produced.has(candidate)) return this.remember(this.ips, ip, candidate);
    }
    return this.remember(this.ips, ip, `${DOC_NET}${(seed % 254) + 1}`);
  }

  private ipv6For(ip: string): string {
    const known = this.ipv6.get(ip);
    return known ?? this.remember(this.ipv6, ip, `2001:db8::${this.ipv6.size + 1}`);
  }

  private nameFor(name: string, kind: string): string {
    const key = `${kind}|${name}`;
    const known = this.names.get(key);
    if (known) return known;
    const n = (this.nameCounters.get(kind) ?? 0) + 1;
    this.nameCounters.set(kind, n);
    return this.remember(this.names, key, `Synthetic ${kind} ${n}`);
  }
}

/** Settings rows (`{ name, type, value }`) carry identifiers, not people: keep their names. */
const isSettingRow = (row: Json): boolean => 'value' in row && 'type' in row;

const KIND_RULES: readonly (readonly [string, (row: Json, type: string) => boolean])[] = [
  [
    'User',
    (row, type) => ['email', 'email_address', 'user_id'].some((k) => k in row) || /user/.test(type),
  ],
  ['Group', (row, type) => type.includes('group') || 'source_type' in row || 'role_ids' in row],
  ['Key', (row, type) => type.includes('key') || 'scopes' in row],
  ['Organization', (row, type) => 'uuid' in row || type.includes('organization')],
];

function kindOf(row: Json): string {
  const type = typeof row.type === 'string' ? row.type : '';
  return KIND_RULES.find(([, matches]) => matches(row, type))?.[0] ?? 'Name';
}
