# Walkthrough: B2-6 F-008 Alert history view and acknowledgement

## Summary

`#/alerts` lists the alerts sent by `pnpm notify` (time, severity, rule ids, channel kinds, title) with their acknowledgement status (Acknowledged / Unacknowledged as icon + label + color), search and a status filter, and explains how to acknowledge. The page is read-only. Acknowledgements are stored as `alerts/ack.json` on the `data/audit` branch (decision D3) and written by `pnpm alerts ack <alert-id> [--by <label>]` and the `Acknowledge Alert` workflow. Closes #73, refs #37.

## Changes Made

### packages/core

- `contracts/alerts-view.ts`: `detailAlertsSchema` (`ALERTS_VIEW_SCHEMA_VERSION = 1`), `detail/alerts.json`, acknowledge command / workflow name constants.
- `application/alerts-history.ts`: `alertId()`, send-record and ack-store schemas (`ACK_STORE_SCHEMA_VERSION = 1`), tolerant `parseAckStore()`, `applyAck()`, `sanitizeAckLabel()` / `sanitizeAlertTitle()`, `appendSent()`.
- `application/presenters/alerts-view.ts`: `buildAlertsView()` joins sends (state history + legacy `lastSent`) and acknowledgements.
- `application/state.ts`: optional `notifications.history` (no version bump; older files still parse; records validated one by one).
- `contracts/detail-view.ts`, `detail-bundle.ts`, `presenters/detail-view.ts`: `alerts` kind, manifest entry, bundle checks (totals, ack fields, duplicate ids, string leaks, e-mail rules).

### packages/collector

- `adapters/storage/ack-store.ts`: `FsAckRepository` (missing / corrupt / unknown version read as empty with a status; atomic deterministic write).
- `main/alerts.ts`, `main/commands.ts`: `alerts ack` command (unknown id rejected, duplicate keeps the first, corrupt store never overwritten), `notify` / `report --notify` record each send; `main/detail.ts`: writes `detail/alerts.json`.
- `adapters/demo/demo-source.ts`, `main/demo.ts`: six synthetic alerts across four channels, three acknowledged.

### .github, scripts, docs

- `workflows/ack-alert.yml` (new, not run): dispatch only, `data/audit` only, env-passed inputs validated by a strict regex, `contents: write`, `audit-data` concurrency, main only. `workflows/collect-audit.yml`: refreshes `detail/alerts.json` after the notify step.
- `scripts/fork-verify.ts`, `.gitignore`: `data/alerts` is forbidden on main.
- Docs: `docs/DASHBOARD-FEATURES.md` F-008, `docs/BLUEPRINT.md` (sections 4 / 9 / 10), `docs/DEPLOYMENT.md`, `docs/SETUP.md`, `docs/ARCHITECTURE.md`, `.agents/rules/storage-and-data-routing.md`.

### packages/dashboard

- `lib/alerts-view.ts`, `pages/Alerts.tsx`, route `/alerts` + nav entry, acknowledgement badges. Reuses `DetailControls.tsx`.

## Verification Results

| Stage                | Command                                                                                | Result                                                                 |
| :------------------- | :------------------------------------------------------------------------------------- | :--------------------------------------------------------------------- |
| Gate                 | `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`    | Pass (exit 0): core 154, collector 130, dashboard 308 tests            |
| Lint / format / deps | `pnpm lint`, `pnpm format:check`, `pnpm audit:deps`                                    | Pass (exit 0)                                                          |
| Sample data          | `pnpm demo` then `git diff --exit-code data/sample`                                    | Only `detail/index.json` changed and `detail/alerts.json` was added    |

## Caveats

- `state.json` gains an additive optional `notifications.history` (needed for channel and severity); alerts sent before this change appear with severity "unknown" and channel "Not recorded".
- The workflow was not run (it needs write access to `data/audit`); the 390 px layout was not checked in a real browser (same table pattern as the other detail pages).
