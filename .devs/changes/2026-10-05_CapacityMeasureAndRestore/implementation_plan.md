# B3-1 Synthetic long history, size measurement with threshold warning, archive restore

Closes #82. Refs #38 (Phase B3, **not** closed here). Parent tracking: #46.

Owner decision: the prerequisites #29 (needs a real tenant) and #37 stay open. This unit is the **key-free implementation** part of #38 ("テストを成立させる実装" 1-6 and What 2-5). The 1-month real-operation record, real-data verification of `pnpm archive`, and a fork run of the workflow are left to a later human-run PR that `Closes #38`.

## User Review Required

> [!IMPORTANT]
> One PR (no split): the pieces share the synthetic-history test support and the archive code. The capacity numbers in `docs/CHANGE-PLAN.md` section 9 are derived from the **synthetic** history and are marked "to be re-validated with real data (B1 V5 / the 1-month record)".

> [!WARNING]
> - No new compliance rule: the size warning is a notification (`capacity:<level>` alert key) and a CLI result, so `docs/BLUEPRINT.md` section 7.1, `README.md`, `README.ja.md` and the rule-ID test are untouched.
> - A measurement failure is a warning only (`size --warn-only`, step `continue-on-error`): collection never fails because of it.
> - `workflow_dispatch` inputs are passed through `env` and validated with an allowlist regex before use. The workflow is not run in this PR.
> - Cloud session: the assigned branch was renamed to `feat/82-capacity-size-restore` per the change-dev rule (the instruction text named the assigned branch; the repository rule and the Branch Name Check workflow take precedence).

## Proposed Changes

### packages/core (pure)

- `[NEW] domain/capacity/capacity.ts`: `parseCountObjects(text)` (`git count-objects -v` parsing), `CapacityThresholds`, `RepoSizeMeasurement` types, `judgeCapacity(measurement, thresholds)` (pure: ok / warning / exceeded per metric; `0` turns a limit off), `capacityAlert(verdict, link)` -> `AlertMessage | null`, `formatBytes`.
- `[MODIFY] index.ts`: export it. Core stays free of Node APIs and I/O.

### packages/collector

- `[NEW] adapters/storage/git-size.ts`: `measureRepository(repoDir, options)` runs `git` through `execFile` (no shell; ref validated): `count-objects -v`, commit count and times, reachable disk usage (`rev-list --objects --disk-usage`), growth over a window (disk usage at the boundary commit), per-dataset distinct blobs and bytes (`rev-list --objects` + `cat-file --batch-check`), and the archive tree listing converted to `ArchiveEntry[]` for the **B2-11 aggregation** `summarizeArchiveEntries`.
- `[MODIFY] adapters/storage/archive.ts`: `restoreArchive(store, selector, out)` (id or year; gunzip, zod validation, writes through `FsSnapshotRepository.save`, never overwrites a stored snapshot, refuses ids that disagree with the file name).
- `[NEW] main/size.ts`, `[NEW] main/restore.ts`, `[NEW] main/deliver.ts` (alert delivery shared with `notify`), `[MODIFY] main/commands.ts`: commands `size [--repo <dir>] [--ref <ref>] [--notify] [--warn-only] [--json]`, `restore <id|year> [--out <dir>]`; `dashboard --snapshot <id>` and `detail --snapshot <id>`.
- `[MODIFY] infrastructure/config.ts`, `config/default.json`: `capacity` block (`maxTotalMiB`, `maxMonthlyGrowthMiB`, `warnRatio`, `windowDays`).
- `[NEW] __tests__/synthetic-history.ts` (test support): fixed-clock generator (span x interval, derived from the demo tenant, per-dataset change frequency) and a temp git repo builder (`git fast-import`, commit by commit, deterministic).
- `package.json`: scripts `size` and `restore`.

### CI

- `[MODIFY] .github/workflows/collect-audit.yml`: `workflow_dispatch` inputs `retention_days` and `dry_run` validated in a first step (env + allowlist regex); `archive` uses the validated override; dry run skips alerts and the save to `data/audit`; non-fatal size step before the save (fetches the `data/audit` history, `size --warn-only --notify`).

### Docs

`docs/CHANGE-PLAN.md` section 9 (capacity guideline), `docs/BLUEPRINT.md` 6.3, `docs/DEPLOYMENT.md` (long-term retention, yearly orphan-branch rotation, tag / Release asset / external storage escape), `docs/SETUP.md` (commands, workflow inputs), `.agents/rules/storage-and-data-routing.md`, `CHANGELOG.md`.

### `pnpm demo`

Not extended: the demo archive stays synthetic and `data/sample` byte-identical (verified with `git diff --exit-code data/sample`).

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- New tests: pure threshold and parser tests (core); synthetic history determinism and change frequencies; dedup, archive-does-not-shrink, threshold trigger / no trigger on real temp git repos; notification through a fake transport; restore round trips (fixture tenant and synthetic history, all datasets byte-identical); restored snapshot regenerates `dashboard.json` and detail files; displayed inventory equals the measured archive; workflow validation.

### Manual Verification

- `pnpm demo` then `git diff --exit-code data/sample`.
