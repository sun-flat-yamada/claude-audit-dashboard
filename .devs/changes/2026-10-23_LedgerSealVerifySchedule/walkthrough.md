# Walkthrough: Seal and verify ledger months on a schedule (#160, U6)

## Summary

The monthly ledger (#154) can now be sealed and verified:

- `pnpm ledger seal --month <yyyy-mm> [--notify]` re-fetches the month through the U5 backfill
  sources and compares it with the ledger. A matching month is sealed in `MANIFEST.json`
  (`sealed: true`, `seal.sealedAt`, per dataset the seal policy, fetch window and fetched rows,
  next to the existing SHA-256 and counts). A differing or not re-fetchable month is not sealed;
  the command exits non-zero and notifies (`ledger-seal:<month>:not-sealed`).
  Seal policies come from a registry per ledger kind: `event` / `daily` compare, `rollup` takes
  the API's calendar-month value, `state` is kept as recorded. Sealing is allowed from the month
  end plus the revision period (`BACKFILL_REVISION_DAYS`).
- A sealed month is never rewritten: later differences (from `ledger update`, backfill or a
  re-seal) are appended to `<month>/revisions/<dataset>.jsonl.gz` and counted in the manifest's
  `revisions`; `ledger verify --notify` sends one notification per new revision count.
- `pnpm ledger verify [--notify] [--json]` reports day gaps in unsealed months (configured daily
  datasets, `ledger.verify.dailyDatasets`, after `lagDays`), the time since the last collection
  (`maxStaleHours`) and hash mismatches of sealed months. The result is stored in
  `data/ledger/STATUS.json`; after `notifyAfterDays` failing days it notifies
  (`ledger-verify:fail`, cooldown applies).
- New local dataset `ledgerHealth` (read from `STATUS.json` and the manifests, never written to
  the ledger) feeds two rules: **OP-003** (ledger verification failing or older than 48 h, High)
  and **OP-004** (month not sealed 20 days after its end, revisions or a failed seal attempt,
  Medium). The rules appear on the dashboard's compliance view without UI changes.
- `SealedMonthSink` port is called after a successful seal (U7 hook, no sinks yet); the ledger
  codec stays pluggable (U8).
- Workflows: `collect-audit.yml` gains a month-end run at 23:30 UTC (cron on the 28th-31st plus
  `month-end-guard.sh`, which skips unless tomorrow is the 1st); `ledger-seal.yml` seals the
  previous month on the 10th (`month` input validated by `validate-ledger-inputs.sh`);
  `ledger-verify.yml` runs daily. All share the `audit-data` concurrency group, restore and save
  through `data-branch.sh` with `REPOSITORY_VISIBILITY` and `GH_TOKEN`, and set
  `AUDIT_CONFIG_OVERRIDES` at job level; they are in the wiring tests.
- Real-tenant checks are split out to #170 (`needs-real-tenant`).

## Modified areas

- Core: `domain/ledger/{seal,verify,health,manifest,datasets}.ts`,
  `domain/compliance/rules/operational.ts`, `application/use-cases/{ledger-seal,ledger-verify,
ledger,ledger-backfill}.ts`, `application/ledger-alert.ts`, `application/ports.ts`.
- Collector: `adapters/storage/{ledger,ledger-status}.ts`, `adapters/demo/demo-ledger.ts`,
  `main/{ledger,ledger-seal,ledger-verify,notify-once,size,container}.ts`,
  `infrastructure/config.ts`.
- CI: `.github/workflows/{collect-audit,ledger-seal,ledger-verify}.yml`,
  `.github/scripts/{month-end-guard,validate-ledger-inputs}.sh`, `scripts/__tests__/`.
- Docs: `docs/BLUEPRINT.md` (§4.2, §5.2, §6.5, §7.1, §12.1, appendix A), `README.md`,
  `README.ja.md`, `docs/{DEPLOYMENT,SETUP,ARCHITECTURE}.md`, `AGENTS.md`,
  `.agents/rules/storage-and-data-routing.md`, compliance-checker agent / skill, `CHANGELOG.md`.
- Sample: `data/sample/` regenerated with `pnpm demo` (32 rules; OP-003 / OP-004 pass).

## Quality gate

| Check                                                                   | Result               |
| :---------------------------------------------------------------------- | :------------------- |
| `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build` | pass                 |
| `pnpm lint`                                                             | pass                 |
| `pnpm format:check`                                                     | pass                 |
| `pnpm test:e2e`                                                         | 565 passed, 250 skipped |

No dashboard source changed, so no screenshots were taken.
