export function BackLink() {
  return (
    <a className="text-sm underline" href="#/orgs">
      All organizations and groups
    </a>
  );
}

export function NotFoundNotice({ kind }: { kind: 'Organization' | 'Group' }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{kind} not found</h1>
      <p role="status" className="mt-3 text-[var(--text-secondary)]">
        This {kind.toLowerCase()} is not in the published data. It may have been unlinked or the
        link is out of date.
      </p>
    </section>
  );
}
