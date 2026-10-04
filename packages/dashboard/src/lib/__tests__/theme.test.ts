import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  parsePreference,
  readStoredPreference,
  resolveTheme,
  storePreference,
  THEME_STORAGE_KEY,
} from '../theme';

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

describe('resolveTheme', () => {
  it('prefers an explicit stored choice over the system', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('follows the system for "system" or nothing stored, defaulting to light', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme(undefined, true)).toBe('dark');
    expect(resolveTheme(undefined, false)).toBe('light');
  });
});

describe('parsePreference', () => {
  it('accepts only the three values', () => {
    expect(parsePreference('dark')).toBe('dark');
    expect(parsePreference('blue')).toBeUndefined();
    expect(parsePreference(null)).toBeUndefined();
  });
});

describe('storage', () => {
  it('round-trips a preference and ignores invalid stored values', () => {
    expect(storePreference('dark')).toBe(true);
    expect(readStoredPreference()).toBe('dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(readStoredPreference()).toBeUndefined();
  });
  it('does not throw when storage is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(readStoredPreference()).toBeUndefined();
    expect(storePreference('dark')).toBe(false);
  });
});

describe('applyTheme', () => {
  it('sets data-theme for light/dark and removes it for system', () => {
    applyTheme('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    applyTheme('system');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });
});
