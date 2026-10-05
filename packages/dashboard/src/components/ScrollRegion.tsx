import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Wraps content that scrolls inside its own box (wide tables). While the content overflows, the
 * box is a named, focusable region so keyboard users can scroll it with the arrow keys
 * (WCAG 2.1.1); otherwise it is a plain container and adds no tab stop.
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () =>
      setOverflowing(
        element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={box}
      className={`${className ?? ''} focus-visible:outline-2 focus-visible:outline-offset-2`}
      {...(overflowing ? { role: 'region', 'aria-label': label, tabIndex: 0 } : {})}
    >
      {children}
    </div>
  );
}
