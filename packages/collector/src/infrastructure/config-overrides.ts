/**
 * Configuration overrides from the `AUDIT_CONFIG_OVERRIDES` environment variable (a JSON object,
 * usually the repository variable of the same name). A fork changes its settings without editing
 * `config/default.json`, so its `main` stays identical to upstream.
 *
 * The overridden values never appear in an error message: they may hold organization-specific
 * names, and errors end up in workflow logs.
 */

export const CONFIG_OVERRIDES_VARIABLE = 'AUDIT_CONFIG_OVERRIDES';

type JsonObject = Record<string, unknown>;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isPlainObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const describeType = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'an array' : `a ${typeof value}`;

function assertSafeKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeKeys(item, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const at = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEYS.has(key))
      throw new Error(`Invalid ${CONFIG_OVERRIDES_VARIABLE}: key not allowed at ${at}`);
    assertSafeKeys(child, at);
  }
}

/**
 * Parses the variable. Blank or absent means no override. Invalid JSON is reported without the
 * parser message, because the JavaScript engine quotes the input in it.
 */
export function parseConfigOverrides(raw: string | undefined): JsonObject | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid ${CONFIG_OVERRIDES_VARIABLE}: not valid JSON (value not shown)`);
  }
  if (!isPlainObject(parsed))
    throw new Error(
      `Invalid ${CONFIG_OVERRIDES_VARIABLE}: expected a JSON object, got ${describeType(parsed)}`,
    );
  assertSafeKeys(parsed, '');
  return parsed;
}

/**
 * Deep merge: plain objects merge key by key; arrays, scalars and `null` replace the base value
 * (arrays are never concatenated). Neither input is modified.
 */
export function mergeConfigOverrides(base: unknown, overrides: JsonObject): JsonObject {
  const result: JsonObject = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(overrides)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    result[key] =
      isPlainObject(value) && isPlainObject(result[key])
        ? mergeConfigOverrides(result[key], value)
        : value;
  }
  return result;
}
