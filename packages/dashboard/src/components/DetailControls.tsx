import type { ReactNode } from 'react';
import type { DetailKind, DetailManifest } from '@claude-audit/core/contracts';
import type { DetailState } from '../lib/detail-data';

/** Shared building blocks of the detail screens (Members, API keys, ...). */
export const FIELD =
  'rounded border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]';
export const CELL = 'border-b border-[var(--grid)] px-2 py-2 align-top [overflow-wrap:anywhere]';
export const HEAD = 'border-b border-[var(--border)] px-2 py-2 font-medium';

export function Notice({ role, children }: { role: 'status' | 'alert'; children: string }) {
  return (
    <p role={role} className="text-[var(--text-secondary)]">
      {children}
    </p>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
        {children}
      </select>
    </label>
  );
}

export function SearchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1 text-sm">
      {label}
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      />
    </label>
  );
}

export function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      />
    </label>
  );
}

export function SortControls<K extends string>({
  keys,
  labels,
  sortKey,
  descending,
  onChange,
}: {
  keys: readonly K[];
  labels: Record<K, string>;
  sortKey: K;
  descending: boolean;
  onChange: (next: { key: K; descending: boolean }) => void;
}) {
  return (
    <>
      <SelectField
        label="Sort by"
        value={sortKey}
        onChange={(key) => onChange({ key: key as K, descending })}
      >
        {keys.map((key) => (
          <option key={key} value={key}>
            {labels[key]}
          </option>
        ))}
      </SelectField>
      <button
        type="button"
        aria-pressed={descending}
        onClick={() => onChange({ key: sortKey, descending: !descending })}
        className={`${FIELD} aria-pressed:bg-[var(--text-primary)] aria-pressed:text-[var(--page)]`}
      >
        Descending
      </button>
    </>
  );
}

/** Toggle-button group with a count per option; `all` shows `total`. */
export function FilterChips<T extends string>({
  label,
  options,
  labels,
  value,
  counts,
  total,
  onChange,
}: {
  label: string;
  options: readonly (T | 'all')[];
  labels: Record<T | 'all', string>;
  value: T | 'all';
  counts: Record<string, number>;
  total: number;
  onChange: (next: T | 'all') => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className="rounded-full border border-[var(--border)] px-3 py-1 text-sm aria-pressed:bg-[var(--text-primary)] aria-pressed:text-[var(--page)]"
        >
          {labels[option]}{' '}
          <span className="tabular">{option === 'all' ? total : counts[option]}</span>
        </button>
      ))}
    </div>
  );
}

/** Why a detail screen has no data: loading, failure, not collected (manifest) or not published. */
export function detailNotice(
  file: DetailState<unknown>,
  manifest: DetailState<DetailManifest>,
  subject: { kind: DetailKind; plural: string; title: string },
): { role: 'status' | 'alert'; text: string } | null {
  if (file.status === 'loading') return { role: 'status', text: `Loading ${subject.plural}…` };
  if (file.status === 'error')
    return { role: 'alert', text: `Failed to load ${subject.plural}: ${file.message}` };
  if (file.status === 'ready') return null;
  const entry =
    manifest.status === 'ready'
      ? manifest.data.files.find((f) => f.kind === subject.kind && f.status === 'unavailable')
      : undefined;
  if (entry) {
    const reason = entry.reason ? ` (${entry.reason})` : '';
    return { role: 'status', text: `${subject.title} data was not collected${reason}.` };
  }
  return {
    role: 'status',
    text: `${subject.title} data is not published. Detail files are only available for sample data or when the owner enabled PAGES_DETAIL_DATA on a private deployment.`,
  };
}
