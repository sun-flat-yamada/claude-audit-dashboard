export interface NavItem {
  path: string;
  label: string;
}

/**
 * Primary navigation. Accessible names: landmark "Primary", links by label, the current page is
 * `aria-current="page"`. The skip link focuses `<main id="main">` itself: a `#main` href would
 * replace the hash and navigate away.
 */
export function NavBar({
  items,
  current,
  onNavigate,
}: {
  items: NavItem[];
  current: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <>
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
      <nav aria-label="Primary" className="border-b border-[var(--border)]">
        <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
          {items.map((item) => (
            <li key={item.path}>
              <a
                href={`#${item.path}`}
                aria-current={item.path === current ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(item.path);
                }}
                className="inline-block px-3 py-3 text-sm aria-[current=page]:border-b-2 aria-[current=page]:font-semibold"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
