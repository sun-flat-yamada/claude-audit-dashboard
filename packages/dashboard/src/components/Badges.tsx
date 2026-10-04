/** Status and severity always pair an icon and a label with the color (never color alone). */
const STATUS: Record<string, { icon: string; color: string; label: string }> = {
  pass: { icon: '✓', color: 'var(--status-good)', label: 'Pass' },
  warning: { icon: '!', color: 'var(--status-warning)', label: 'Review' },
  fail: { icon: '✕', color: 'var(--status-critical)', label: 'Fail' },
  error: { icon: '!', color: 'var(--status-serious)', label: 'Error' },
  skipped: { icon: '–', color: 'var(--status-neutral)', label: 'Skipped' },
  ok: { icon: '✓', color: 'var(--status-good)', label: 'Collected' },
  unavailable: { icon: '–', color: 'var(--status-neutral)', label: 'Unavailable' },
  active: { icon: '✓', color: 'var(--status-good)', label: 'Active' },
  inactive: { icon: '!', color: 'var(--status-warning)', label: 'Inactive' },
  unknown: { icon: '?', color: 'var(--status-neutral)', label: 'Unknown' },
  'key-rotate': { icon: '✕', color: 'var(--status-critical)', label: 'Rotate' },
  'key-unused': { icon: '!', color: 'var(--status-serious)', label: 'Unused' },
  'key-privileged': { icon: '!', color: 'var(--status-serious)', label: 'Write scope' },
  'key-rotate_soon': { icon: '!', color: 'var(--status-warning)', label: 'Rotate soon' },
  'key-unknown': { icon: '?', color: 'var(--status-neutral)', label: 'Use unknown' },
  'key-ok': { icon: '✓', color: 'var(--status-good)', label: 'OK' },
  'key-inactive': { icon: '–', color: 'var(--status-neutral)', label: 'Deactivated' },
};

const SEVERITY: Record<string, string> = {
  critical: 'var(--status-critical)',
  high: 'var(--status-serious)',
  medium: 'var(--status-warning)',
  low: 'var(--status-neutral)',
  info: 'var(--status-neutral)',
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { icon: '?', color: 'var(--status-neutral)', label: status };
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
      <span
        aria-hidden
        className="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ background: s.color }}
      >
        {s.icon}
      </span>
      {s.label}
    </span>
  );
}

export function SeverityLabel({ severity }: { severity: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm capitalize">
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: SEVERITY[severity] ?? 'var(--status-neutral)' }}
      />
      {severity}
    </span>
  );
}
