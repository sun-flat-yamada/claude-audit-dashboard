import { useCallback, useMemo, useSyncExternalStore } from 'react';

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

/** Query parameters of a hash route; the first value of a repeated key wins. */
export type HashQuery = Record<string, string>;

/**
 * `#/compare?base=a&target=b` -> `{ base: 'a', target: 'b' }`. Never throws: a malformed escape is
 * kept as typed, a hash without `?` gives `{}`. Callers read the keys they know and ignore the
 * rest, so an unknown parameter never breaks a route.
 */
export function parseHashQuery(hash: string): HashQuery {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const at = raw.indexOf('?');
  const query: HashQuery = {};
  if (at === -1) return query;
  for (const [key, value] of new URLSearchParams(raw.slice(at + 1))) {
    if (key !== '' && !(key in query)) query[key] = value;
  }
  return query;
}

/** `#/path` plus `?k=v` for every non-empty query value, in the given key order. */
export function formatHash(path: string, query: HashQuery = {}): string {
  const segments = path.split('/').filter(Boolean).map(encodeURIComponent);
  const search = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '')).toString();
  return `#/${segments.join('/')}${search === '' ? '' : `?${search}`}`;
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

/**
 * Rewrites the query of the current route without adding a history entry (selectors must not
 * flood the back button) and tells the hash subscribers, because `replaceState` fires no event.
 */
export function replaceQuery(path: string, query: HashQuery): void {
  window.history.replaceState(window.history.state, '', formatHash(path, query));
  window.dispatchEvent(new Event('hashchange'));
}

/** Query of the current hash (re-renders on hash change). */
export function useHashQuery(): HashQuery {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  );
  return useMemo(() => parseHashQuery(hash), [hash]);
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
