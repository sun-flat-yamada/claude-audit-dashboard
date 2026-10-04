import { useCallback, useSyncExternalStore } from 'react';

/**
 * Minimal hash router. Only `location.hash` is used, so deep links (`<base>#/members`) work
 * under any `VITE_BASE_PATH` on static hosting such as GitHub Pages, and the browser's
 * back / forward buttons work through `hashchange`.
 */

/** `#/a/b/`, `/a/b`, `` and `#` normalise to `/a/b`, `/a/b`, `/` and `/`. */
export function parseHash(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const path = raw.split(/[?]/, 1)[0] ?? '';
  const segments = path.split('/').filter(Boolean).map(safeDecode);
  return `/${segments.join('/')}`;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function formatHash(path: string): string {
  const segments = path.split('/').filter(Boolean).map(encodeURIComponent);
  return `#/${segments.join('/')}`;
}

/** Expands `/reports/monthly/:id` style patterns; returns params or null when not matching. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/').filter(Boolean);
  const have = path.split('/').filter(Boolean);
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const part = want[i] as string;
    const value = have[i] as string;
    if (part.startsWith(':')) params[part.slice(1)] = value;
    else if (part !== value) return null;
  }
  return params;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function navigate(path: string): void {
  window.location.hash = formatHash(path);
}

/** Current route path (re-renders on hash change) and a navigate function. */
export function useHashRoute(): [string, (path: string) => void] {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  );
  const go = useCallback((path: string) => navigate(path), []);
  return [parseHash(hash), go];
}
