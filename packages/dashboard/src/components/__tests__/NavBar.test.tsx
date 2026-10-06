import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { groupNavItems, NavBar, type NavGroup, type NavItem } from '../NavBar';

const GROUPS: NavGroup[] = [
  { id: 'usage', label: 'Usage' },
  { id: 'directory', label: 'Directory' },
];
const ITEMS: NavItem[] = [
  { path: '/', label: 'Overview' },
  { path: '/members', label: 'Members', group: 'directory' },
  { path: '/models', label: 'Models', group: 'usage' },
  { path: '/odd', label: 'Odd', group: 'unknown' },
  { path: '/keys', label: 'API keys', group: 'directory' },
];

describe('groupNavItems', () => {
  it('puts ungrouped (and unknown-group) items first, then the groups in their order', () => {
    expect(
      groupNavItems(ITEMS, GROUPS).map((s) => [s.label ?? '', s.items.map((i) => i.label)]),
    ).toEqual([
      ['', ['Overview', 'Odd']],
      ['Usage', ['Models']],
      ['Directory', ['Members', 'API keys']],
    ]);
  });

  it('drops empty sections', () => {
    expect(groupNavItems([{ path: '/models', label: 'Models', group: 'usage' }], GROUPS)).toEqual([
      {
        id: 'usage',
        label: 'Usage',
        items: [{ path: '/models', label: 'Models', group: 'usage' }],
      },
    ]);
  });
});

describe('NavBar', () => {
  it('names each group list by its label and marks the current page', () => {
    render(<NavBar items={ITEMS} groups={GROUPS} current="/members" onNavigate={() => {}} />);
    const directory = screen.getByRole('list', { name: 'Directory' });
    expect(
      within(directory)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Members', 'API keys']);
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Models' })).toHaveAttribute('href', '#/models');
  });

  it('toggles the menu, closes it on Escape and after a choice, and returns focus', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<NavBar items={ITEMS} groups={GROUPS} current="/" onNavigate={onNavigate} />);
    const button = screen.getByRole('button', { name: 'Menu' });
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('link', { name: 'Models' }));
    expect(onNavigate).toHaveBeenCalledWith('/models');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
    await user.click(button);
    screen.getByRole('link', { name: 'Overview' }).focus();
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });
});
