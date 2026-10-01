import type { Severity } from '@claude-audit/core';

export const SEVERITY_COLORS: Readonly<Record<Severity, number>> = {
  critical: 0xdc2626,
  high: 0xea580c,
  medium: 0xd97706,
  low: 0x2563eb,
  info: 0x6b7280,
};

/**
 * POSTs JSON to a webhook. Webhook URLs embed their secret, so errors never include the URL.
 */
export async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  channel: string,
): Promise<void> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${channel} webhook responded ${response.status}`);
}

export const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;
