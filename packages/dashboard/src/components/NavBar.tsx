import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

export interface NavItem {
  path: string;
  label: string;
  /** Id of a {@link NavGroup}; items without one (or with an unknown one) lead the navigation. */
  group?: string;
}

export interface NavGroup {
  id: string;
  label: string;
}

export interface NavSection {
  id: string;
  /** Visible group label; the leading section of ungrouped items has none. */
  label?: string;
  items: NavItem[];
}

/**
 * Splits the items into sections: the ungrouped items first, then one section per group in the
 * order of `groups`. Inside a section the items keep their order; empty sections are dropped.
 */
export function groupNavItems(items: NavItem[], groups: NavGroup[]): NavSection[] {
  const known = new Set(groups.map((g) => g.id));
  const lead: NavSection = {
    id: 'main',
    items: items.filter((item) => !item.group || !known.has(item.group)),
  };
  const grouped = groups.map((g) => ({
    id: g.id,
    label: g.label,
    items: items.filter((item) => item.group === g.id),
  }));
  return [lead, ...grouped].filter((section) => section.items.length > 0);
}

interface SectionsProps {
  sections: NavSection[];
  current: string;
  idPrefix: string;
  onSelect: (path: string) => void;
}

/** The grouped links: one list per section, named by its visible label (not a heading). */
function NavSections({ sections, current, idPrefix, onSelect }: SectionsProps) {
  return (
    <>
      {sections.map((section) => {
        const labelId = `${idPrefix}-${section.id}`;
        return (
          <div key={section.id} className="mt-3 first:mt-1">
            {section.label ? (
              <p
                id={labelId}
                className="px-3 pb-1 text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase"
              >
                {section.label}
              </p>
            ) : null}
            <ul aria-labelledby={section.label ? labelId : undefined}>
              {section.items.map((item) => (
                <li key={item.path}>
                  <a
                    href={`#${item.path}`}
                    aria-current={item.path === current ? 'page' : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      onSelect(item.path);
                    }}
                    className="block border-l-2 border-transparent px-3 py-1.5 text-sm hover:underline aria-[current=page]:border-current aria-[current=page]:font-semibold"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" className="shrink-0">
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

interface MenuButtonProps {
  buttonRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  controls: string;
  onToggle: () => void;
}

/** Disclosure button of the narrow layout (hidden from 1024px, where every link is shown). */
function MenuButton({ buttonRef, open, controls, onToggle }: MenuButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="my-2 inline-flex items-center gap-2 rounded border border-[var(--border)] px-3 py-1.5 text-sm lg:hidden"
    >
      <MenuIcon />
      Menu
    </button>
  );
}

function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(event) => {
        event.preventDefault();
        document.getElementById('main')?.focus();
      }}
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded focus:bg-[var(--surface-1)] focus:px-3 focus:py-2"
    >
      Skip to main content
    </a>
  );
}

/**
 * Primary navigation, grouped by `groups`. From 1024px (`lg`) it is a sticky side column with every
 * link visible; below that a "Menu" disclosure button (`aria-expanded` / `aria-controls`) shows the
 * same links, Escape closes it and returns focus to the button, and following a link closes it.
 * Accessible names: landmark "Primary", links by label, the current page is `aria-current="page"`.
 * The skip link focuses `<main id="main">` itself: a `#main` href would replace the hash.
 */
export function NavBar({
  items,
  groups = [],
  current,
  onNavigate,
  actions,
}: {
  items: NavItem[];
  groups?: NavGroup[];
  current: string;
  onNavigate: (path: string) => void;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const listId = `${id}-links`;

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) close();
  }

  function select(path: string) {
    if (open) close();
    onNavigate(path);
  }

  return (
    <>
      <SkipLink />
      <nav
        aria-label="Primary"
        onKeyDown={onKeyDown}
        className="flex flex-wrap items-center gap-x-2 border-b border-[var(--border)] px-4 sm:px-6 lg:sticky lg:top-0 lg:h-screen lg:w-56 lg:shrink-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-3 lg:py-4"
      >
        <MenuButton
          buttonRef={button}
          open={open}
          controls={listId}
          onToggle={() => setOpen((value) => !value)}
        />
        <div
          id={listId}
          className={`order-last w-full pb-3 lg:order-none lg:block lg:pb-0 ${open ? '' : 'hidden'}`}
        >
          <NavSections
            sections={groupNavItems(items, groups)}
            current={current}
            idPrefix={id}
            onSelect={select}
          />
        </div>
        <div className="ml-auto lg:mt-auto lg:ml-0 lg:px-3 lg:pt-4">{actions}</div>
      </nav>
    </>
  );
}
