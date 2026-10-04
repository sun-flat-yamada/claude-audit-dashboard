export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'claude-audit-theme';
export const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function parsePreference(value: unknown): ThemePreference | undefined {
  return value === 'light' || value === 'dark' || value === 'system' ? value : undefined;
}

/** Stored preference, or undefined when nothing valid is stored or storage is blocked. */
export function readStoredPreference(): ThemePreference | undefined {
  try {
    return parsePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

/** Best effort: returns false when storage is blocked (the choice then lasts for the session). */
export function storePreference(pref: ThemePreference): boolean {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
    return true;
  } catch {
    return false;
  }
}

export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** Order: explicit stored light/dark > system preference > light default. */
export function resolveTheme(
  stored: ThemePreference | undefined,
  prefersDark: boolean,
): ResolvedTheme {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

/** `system` removes the attribute so the `prefers-color-scheme` media query applies. */
export function applyTheme(pref: ThemePreference, root: HTMLElement = document.documentElement) {
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}
