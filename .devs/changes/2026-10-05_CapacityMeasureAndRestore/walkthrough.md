# Walkthrough: B3-1 Synthetic long history, size measurement, archive restore

Closes #82. Refs #38 (not closed: the real-data part stays open).

## Summary

The key-free implementation part of #38: long histories (400+ days x 6 hours) are synthesized and committed into a temporary git repository so CI can prove deduplication, "archive does not shrink the history" and the threshold behavior; `pnpm size` measures a git repository and judges it with a pure function against `capacity.*`; `pnpm restore` writes `archive/*.json.gz` back to `snapshots/<id>/` byte-identically and `build:data` / `build:detail` accept `--snapshot <id>`; `collect-audit.yml` gains validated manual inputs and a non-fatal size step. No real data, no new compliance rule, `data/sample` byte-identical.

## Changes Made

### packages/core

- `domain/capacity/capacity.ts`: `parseCountObjects` (`-v` and `-vH`), `judgeCapacity`, `monthlyGrowthBytes`, `formatBytes` (pure). `application/capacity-alert.ts`: `capacityAlert` (key `capacity:<level>`).

### packages/collector

- `adapters/storage/git-size.ts`: `measureRepository` (git via `execFile`, validated ref / prefix; count-objects, reachable size, window growth, per-dataset blobs, archive tip listing aggregated with the B2-11 `summarizeArchiveEntries`).
- `adapters/storage/archive.ts`: `restoreArchive`; `repositories.ts`: pure `snapshotFiles` (shared by the writer and the test history); `file-store.ts`: `readBytes`.
- `main/size.ts`, `main/deliver.ts` (shared with `notify`), `main/commands.ts` (`size`, `restore`, `--snapshot`), `main/workflows.ts` (`resolveTarget`), `main/detail.ts`, `infrastructure/config.ts` + `config/default.json` (`capacity`).
- `__tests__/synthetic-history.ts`: fixed-clock generator and `git fast-import` repository builder (test support).

### CI and docs

- `.github/workflows/collect-audit.yml`, `.github/scripts/validate-dispatch-inputs.sh`; `package.json` scripts `size` / `restore`.
- `docs/CHANGE-PLAN.md` section 9.4 (synthetic-based numbers), `docs/BLUEPRINT.md` 6.3 / 6.4 / 12.1 / appendix A, `docs/DEPLOYMENT.md` (rotation, tag / Release asset / external storage escape), `docs/SETUP.md`, `docs/ARCHITECTURE.md`, `.agents/rules/storage-and-data-routing.md`, `CHANGELOG.md`.

## Tests

- core: parser, threshold boundaries, growth projection, alert content.
- collector (real temporary git repositories): determinism (same commit ids); dedup per dataset (1 blob for an unchanged dataset over 1,600 snapshots, one per epoch otherwise, a repeated snapshot adds no dataset blob); archive shrinks the working tree and never the history; thresholds trigger / stay quiet on a measured history; displayed inventory (`summarizeArchive`, `detail/archive.json`) equals the measured archive; restore round trip byte-identical for every dataset (B1 fixture tenant and synthetic history, year / id / `--out`); restored snapshot regenerates `dashboard.json` and the detail files (byte-identical to the pre-archive build); `size` CLI (quiet within limits, one alert via a fake Slack transport, cooldown, `--json`, `--warn-only` makes measurement and notification failures warnings).
- scripts: dispatch input validation (accept / reject hostile values without echo), workflow guards (no `${{` in `run:`, inputs only via env, dry run skips alerts and save, size step non-fatal and before the save).

## Verification Results

| Stage                    | Command                          | Result                                          |
| :----------------------- | :------------------------------- | :---------------------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`               | Clean (exit 0)                                  |
| TypeScript Check         | `pnpm typecheck`                 | Pass (exit 0)                                   |
| Unit & Integration Tests | `pnpm test`                      | core 175, collector 165, dashboard 335, scripts 32 pass |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | 0 leaks (exit 0)                                |
| Production Build         | `pnpm build`                     | Built                                           |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | Clean                                           |
| Dependency audit (CI)    | `pnpm audit:deps`                | No known vulnerabilities                        |
| Sample unchanged         | `pnpm demo && git diff --exit-code data/sample` | Clean                            |

## Left for humans (#38 stays open)

- 1-month (or longer) real operation record of the `data/audit` increment (counts and sizes only, as an Issue comment) and re-validation of the section 9.4 numbers / `capacity.*` defaults with real data (B1 V5).
- Real-data run of `pnpm archive` (short retention on a verification fork) and restore of real archives.
- A fork run of `collect-audit.yml` with `retention_days` / `dry_run` (not run here) to confirm the size step on a real `data/audit` branch (including the shallow-fetch handling).
