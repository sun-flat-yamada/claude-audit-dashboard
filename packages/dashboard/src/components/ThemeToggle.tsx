import { useState } from 'react';
import {
  applyTheme,
  readStoredPreference,
  storePreference,
  THEME_OPTIONS,
  type ThemePreference,
} from '../lib/theme';

/**
 * Light / dark / system switch. Native buttons give Tab and Enter/Space; the active choice is
 * `aria-pressed`. Persistence is best effort: with blocked storage the choice still applies for
 * the session.
 */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>(() => readStoredPreference() ?? 'system');

  function choose(next: ThemePreference) {
    setPref(next);
    applyTheme(next);
    storePreference(next);
  }

  return (
    <div role="group" aria-label="Theme" className="flex items-center gap-1 py-2">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={pref === option.value}
          onClick={() => choose(option.value)}
          className="rounded border border-[var(--border)] px-2 py-1 text-xs aria-pressed:bg-[var(--text-primary)] aria-pressed:text-[var(--page)]"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
