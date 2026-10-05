# B2-6 F-008 Alert history view and acknowledgement (#/alerts)

Closes #73. Refs #37 (tracking). Plan source: `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` section B2-6. Owner accepted D1-D8; D3: the acknowledgement lives in `alerts/ack.json` on the `data/audit` branch (not in `state.json`), is updated by `pnpm alerts ack <alert-id> [--by <label>]` and a `workflow_dispatch` workflow, and "repo write access" is the accepted condition for who may acknowledge. Patterns reused: B2-7 (monthly), B2-12 (configuration, redaction allowlist) and B2-11 (archive).

## User Review Required

> [!IMPORTANT]
> `state.json` today only keeps `notifications.lastSent` (dedupe key -> time, pruned after the cooldown): no channel, severity or title. To show channel kind and severity the unit adds an **additive optional** `notifications.history` (send records, capped) to `state.json`, written by `pnpm notify` and `report --notify`. `STATE_SCHEMA_VERSION` stays 2 and older files (without the field) still parse, so `parseState()` does not reset anything (tested). Alerts that exist only in `lastSent` (sent before this change) are still listed, with channel "not recorded" and severity "unknown". The acknowledgement itself stays out of `state.json`, as decided in D3.

> [!WARNING]
> The page is strictly read-only: a static SPA cannot write, so it shows the acknowledgement state and how to acknowledge (the command and the workflow name). The workflow (`ack-alert.yml`) is added but never run by this change. The acknowledger label is free text: it is sanitized when written and again when the public file is built, and anything that looks like an e-mail address, URL, secret or path is replaced by `[hidden]`. Alert titles go through the same allowlist approach as B2-12; the finding messages (which can carry evidence) are not part of the public file, only rule ids and statuses.

## Proposed Changes

### packages/core (pure)

- `[NEW] contracts/alerts-view.ts` (exported from `contracts/index.ts`): `ALERTS_VIEW_SCHEMA_VERSION = 1`, `DETAIL_ALERTS_PATH = detail/alerts.json`, `detailAlertsSchema` (totals, alerts with id, sentAt, kind, severity, title, channels, findings, acknowledgement), constants for the acknowledge command / workflow name.
- `[MODIFY] contracts/detail-view.ts`, `contracts/detail-bundle.ts`: `DETAIL_KINDS` gains `alerts`; schema, count, totals consistency, ack-pair consistency, leak check (no URL / e-mail / secret / path in any string).
- `[NEW] application/alerts-history.ts`: `alertId()` (stable hash of key + sentAt), send-record and ack-store schemas (`ACK_STORE_SCHEMA_VERSION = 1`), tolerant `parseAckStore()`, `applyAck()` (acknowledged / already acknowledged / unknown id), `sanitizeAckLabel()`, `appendSent()` (cap).
- `[NEW] application/presenters/alerts-view.ts`: `buildAlertsView()` joins the send records (history + legacy `lastSent`) with the acknowledgements.
- `[MODIFY] application/state.ts`: optional `notifications.history` (default `[]`); `presenters/detail-view.ts`: manifest entry (`ok`, or `unavailable` with a fixed reason).

### packages/collector

- `[NEW] adapters/storage/ack-store.ts`: `FsAckRepository` (`alerts/ack.json`; missing / corrupt / unknown version read as empty with a status; atomic deterministic write through `FileStore`).
- `[NEW] main/alerts.ts`: `ackAlert()` (refuses a corrupt store so acknowledgements are never overwritten) and `readAlertsInput()`.
- `[MODIFY] main/commands.ts`: `alerts ack <alert-id> [--by <label>]`; `notify` / `report --notify` record the send; `main/detail.ts`: writes `detail/alerts.json`; `main/demo.ts` + `adapters/demo/demo-source.ts`: synthetic history and acknowledgements; root `package.json`: `alerts` script.

### .github

- `[NEW] workflows/ack-alert.yml`: `workflow_dispatch` only (inputs `alert-id`, optional `by-label`), `contents: write`, `audit-data` concurrency group, checkout of `main`, `data-branch.sh restore`, `pnpm alerts ack`, `data-branch.sh save` (commits to `data/audit` only). Inputs travel through `env` and a strict regex check; no secrets are used or echoed.

### packages/dashboard

- `[NEW] lib/alerts-view.ts` (search, status filter, counts), `pages/Alerts.tsx`, route `/alerts` + nav entry "Alerts"; `components/Badges.tsx` gains the acknowledgement statuses. Reuses `DetailControls.tsx`, `Badges`, `Card`.
- States: loading, not published, not collected (reason from the manifest), error, empty (no alerts sent), no match.

### Tests

core (id, ack unknown / duplicate, label redaction, join, bundle check negatives, state compatibility), collector (ack store missing / corrupt / duplicate, CLI, notify records, detail writer, demo golden), dashboard (helpers, every state, deep link, stage-data).

### Docs

`docs/DASHBOARD-FEATURES.md` F-008, `docs/BLUEPRINT.md` sections 4.2 / 9, `docs/DEPLOYMENT.md`, `docs/SETUP.md`, `.agents/rules/storage-and-data-routing.md`.

## Verification Plan

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- `pnpm demo` then `git diff --exit-code data/sample` is clean; only `detail/index.json` changes and `detail/alerts.json` is added.
- Manual: `DASHBOARD_DATA_SOURCE=sample pnpm dev`, open `#/alerts` at 390 px in both themes.
