import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '../../lib/theme';
import { ThemeToggle } from '../ThemeToggle';

const html = document.documentElement;
const button = (name: string) => screen.getByRole('button', { name });

afterEach(() => {
  vi.restoreAllMocks();
  html.removeAttribute('data-theme');
});

describe('ThemeToggle', () => {
  it('exposes a named group with three buttons and System pressed by default', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    expect(button('System')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Light')).toHaveAttribute('aria-pressed', 'false');
    expect(button('Dark')).toHaveAttribute('aria-pressed', 'false');
    expect(html).not.toHaveAttribute('data-theme');
  });

  it('applies and persists the choice, and restores it on remount', async () => {
    const user = userEvent.setup();
    const first = render(<ThemeToggle />);
    await user.click(button('Dark'));
    expect(html).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    first.unmount();
    render(<ThemeToggle />);
    expect(button('Dark')).toHaveAttribute('aria-pressed', 'true');
  });

  it('system removes the forced theme', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(button('Light'));
    expect(html).toHaveAttribute('data-theme', 'light');
    await user.click(button('System'));
    expect(html).not.toHaveAttribute('data-theme');
    expect(button('System')).toHaveAttribute('aria-pressed', 'true');
  });

  it('is operable with the keyboard', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.tab();
    expect(button('Light')).toHaveFocus();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(button('Dark')).toHaveAttribute('aria-pressed', 'true');
    await user.tab();
    await user.keyboard(' ');
    expect(button('System')).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders the default and still toggles for the session when storage is denied', async () => {
    const deny = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(deny);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(deny);
    const user = userEvent.setup();
    render(<ThemeToggle />);
    expect(button('System')).toHaveAttribute('aria-pressed', 'true');
    await user.click(button('Dark'));
    expect(button('Dark')).toHaveAttribute('aria-pressed', 'true');
    expect(html).toHaveAttribute('data-theme', 'dark');
  });
});
