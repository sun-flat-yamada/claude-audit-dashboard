import type { ReactNode } from 'react';

export function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-[var(--text-muted)]">{children}</p>
);

/** Table twin of a chart (accessible, printable, exact values). */
export function TableView({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-[var(--text-secondary)]">View as table</summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="tabular w-full text-left">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} className="border-b border-[var(--grid)] py-1 pr-4 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row[0])}>
                {row.map((cell, i) => (
                  <td key={i} className="border-b border-[var(--grid)] py-1 pr-4">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
