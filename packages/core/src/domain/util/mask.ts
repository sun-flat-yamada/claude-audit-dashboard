const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** `jane.doe@example.com` -> `j***@example.com`; applied to every address in the text. */
export const maskEmails = (text: string): string => text.replace(EMAIL, '$1***@$2');

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** `Alice Engineer` -> `A*** E***`: keeps initials so rows stay recognisable without the name. */
export const maskName = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${[...word][0]}***`)
    .join(' ');

/**
 * Stable, non-reversible-enough short identifier (`prefix_` + 12 hex characters, 53-bit cyrb53).
 * The same input always yields the same output, so masked rows stay joinable across files.
 * It hides the raw ID in published views; it is not a cryptographic commitment.
 */
export function hashId(prefix: string, value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `${prefix}_${(n % 2 ** 48).toString(16).padStart(12, '0')}`;
}

/** Identifier policy shared by every detail presenter: masked (hashed) or passed through. */
export interface IdentityMasker {
  readonly masked: boolean;
  id(prefix: string, value: string): string;
  email(value: string): string;
  name(value: string): string;
  ip(value: string | null): string | null;
  /** E-mail addresses inside free text. */
  text(value: string): string;
}

export const identityMasker = (masked: boolean): IdentityMasker => ({
  masked,
  id: (prefix, value) => (masked ? hashId(prefix, value) : value),
  email: (value) => (masked ? maskEmails(value) : value),
  name: (value) => (masked ? maskName(value) : value),
  ip: (value) => (masked ? null : value),
  text: (value) => (masked ? maskEmails(value) : value),
});
