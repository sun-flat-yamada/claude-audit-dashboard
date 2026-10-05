# Dashboard Feature Requirements

> **Status:** Living document. Phase A (dashboard v2) implemented; Phase B items are planned.
> **Last updated:** 2026-10-01
> **Data contract:** `DashboardView` schemaVersion 2 (`packages/core/src/contracts/dashboard-view.ts`)

---

## Principles

- **Claude Enterprise vocabulary.** Enterprise tenants are organized as _linked organizations_ and _RBAC groups_; there are no Console workspaces. Breakdowns use product, model and RBAC group.
- **Aggregates only in `dashboard.json`.** The file may be published on Pages, so it carries counts, totals and masked identifiers. Views that need per-person data (member list, key inventory, activity search, group drill-down) read the separate **detail files** (`detail/*.json`, contract `DETAIL_SCHEMA_VERSION = 1`, below), which are published to Pages only with `PAGES_DETAIL_DATA=true`.
- **Honest coverage.** Every view that depends on a dataset says so when it was not collected; the score is shown with the number of rules actually assessed.
- **One system of charts.** Fixed categorical color order, legend for two or more series, a table view for every chart, no dual axes, status shown with icon + label + color, light and dark themes, no horizontal scroll at 390 px.

---

## Feature matrix

| ID    | Feature                         | Priority | Status                                                        | Contract fields                                         |
| ----- | ------------------------------- | -------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| F-001 | Organization overview           | P0       | ✅ Phase A                                                    | `title`, `organizations`, `collectedAt`, `kpis`         |
| F-002 | Compliance score and trend      | P0       | ✅ Phase A                                                    | `kpis[score]`, `compliance.history`                     |
| F-003 | Compliance results              | P0       | ✅ Phase A + CSV / JSON export (B2-1)                         | `compliance.results`, `compliance.byCategory`           |
| F-004 | Usage and cost                  | P0       | ✅ Phase A                                                    | `usage.daily`, `usage.byProduct/byModel/byGroup`        |
| F-005 | Activity                        | P0       | ✅ Phase A aggregates; B2 (B2-3, `#/activity`) search         | `activity`                                              |
| F-006 | Member view                     | P1       | ✅ Phase B2 (B2-4, `#/members`)                               | detail `members.json` (B2-2)                            |
| F-007 | API key inventory               | P1       | ✅ Phase B2 (B2-5, `#/keys`)                                  | detail `api-keys.json` (B2-2)                           |
| F-008 | Alert history                   | P1       | ✅ B2-6 (`#/alerts`)                                          | detail `alerts.json`                                    |
| F-009 | Monthly cost report view        | P1       | ✅ B2-7 (`#/reports/monthly`, `#/reports/monthly/<id>`)       | detail `monthly/index.json`, `monthly/<id>.json`        |
| F-010 | Model usage analytics           | P1       | ✅ Phase A + B2-8 (`#/models`, opt-in model × group data)     | `usage.byModel`, `insights`, detail `usage-matrix.json` |
| F-011 | Light / dark theme              | P2       | ✅ Phase A (follows system); toggle UI in Phase B2 (B2-9)     | —                                                       |
| F-012 | Organization / group drill-down | P2       | ✅ B2-10 (`#/orgs`, `#/orgs/<id>`, `#/groups/<id>`)           | detail `org-groups.json`, `members.json`                |
| F-013 | Data coverage and retention     | P2       | ✅ coverage in Phase A; archive inventory B2-11 (`#/archive`) | `coverage`, detail `archive.json`                       |
| F-014 | Configuration view (read-only)  | P2       | ✅ B2-12 (`#/config`)                                         | detail `config.json`                                    |
| F-015 | Snapshot comparison             | P3       | ⏳ Later                                                      | —                                                       |
| F-016 | Adoption (DAU / WAU / MAU)      | P1       | ✅ Phase A                                                    | `adoption`                                              |
| F-017 | Insights                        | P1       | ✅ Phase A                                                    | `insights`                                              |

---

## Implemented (Phase A)

### F-001 Organization overview

- Header: dashboard title, linked organization names, last collection time, a "Demo data" badge when `source = demo`.
- KPI tiles: open findings (failed + warnings), members, monthly active users, seat utilization (30 days), month-to-date cost. A tile shows `—` when its dataset was not collected.

### F-002 Compliance score and trend

- Hero figure: score out of 100 with the failed / to-review / error / skipped counts.
- When rules were skipped or errored, a warning line states `N of M rules assessed` and points to Data coverage.
- Score trend (single series, 0–100 axis) appears once two or more reports exist.

### F-003 Compliance results

- Status filter (All / Fail / Review / Error / Skipped / Pass) with counts.
- Order: fail, error, warning, skipped, pass; then severity; then rule ID.
- Each row expands to the remediation text and up to 20 evidence items (masked).
- Failing rules by category as labeled bars (`failed of evaluated`).
- Own page at `#/compliance` (also on the Overview).
- Export (client-side, nothing is uploaded): "Export CSV (<filter>)" / "Export JSON (<filter>)" for the filtered view and "Export all CSV" / "Export all JSON" for every result. File names are `compliance-results-<collection date yyyymmdd>[-<status>].csv|json`.
- CSV: the first five columns (`Rule, Name, Severity, Status, Message`) are `COMPLIANCE_EXPORT_COLUMNS` from `@claude-audit/core/contracts`, shared with `pnpm report:compliance`; then `Category, Remediation, Evidence`. RFC 4180 quoting, CRLF; cells starting with `=` `+` `-` `@`, tab or CR get a leading `'` (spreadsheet formula-injection guard). JSON lists the same fields with a fixed key order and names the filter.

### F-004 Usage and cost

- Daily cost: line with a 10% area wash, crosshair tooltip, compact axis ticks, exact values in the tooltip and table view.
- Daily tokens: input (including cache reads and writes) and output as two lines with a legend.
- Spend by product, by model and by RBAC group: horizontal bars with the amount and share at the tip. Group shares can exceed 100% in total because a member can belong to several groups (noted in the card).
- Phase B: cache read share over time, budget progress (UA-002 already reports month-to-date and forecast).

### F-005 Activity (aggregates and timeline)

- Total events in the last collection window, with the window bounds.
- Top 10 activity types as labeled bars.
- Events matched by activity-watch rules (AM-xxx): time, type, rule, masked actor (up to 30).
- Phase B2 (B2-3): own page `#/activity` reading the detail manifest and the monthly `detail/activity-<yyyy-mm>.json` files (never `dashboard.json`).
  - Month selector from the manifest (newest first); only the selected month file is fetched. A month that is listed but missing shows "not published"; an unavailable dataset shows the manifest reason.
  - Search (type, actor ID / e-mail / IP, organization), activity type, actor kind and a date range (inclusive UTC days within the month); filters reset the page to 1.
  - Timeline table, newest first, 50 rows per page with Previous / Next and "Page n of m". Actor kind is shown as icon + label + color (User, API key, Unauthenticated, ...). Identifiers, e-mail addresses and IPs are printed exactly as published (masked while the manifest says `maskPii: true`) with a note.
  - A capped month (`truncated`) shows "This month has N activities; the file keeps only the newest M".
  - Not included yet: filter state in the URL (the router has no query support) and a count-by-day chart.
  - The demo tenant has three UTC months (July / August routine history, September recent events) so paging and month switching can be tried on the sample.

### F-011 Light / dark theme

- Follows `prefers-color-scheme`; `data-theme="light|dark"` on `<html>` forces a theme.
- Phase B2 (B2-9): a Light / Dark / System switch in the primary navigation (group "Theme", buttons with `aria-pressed`, keyboard operable). The choice is stored in `localStorage` (`claude-audit-theme`); an inline script in `index.html` applies it before first paint. Every storage access is guarded: when storage is blocked the page renders the default (system) theme and the switch still works for the session. "System" removes `data-theme`.
- Categorical series colors (slots 1–3) validated for both themes; the light-theme third slot is below 3:1 contrast, so every multi-series chart ships a legend and a table view.

### F-013 Data coverage

- One row per dataset: status badge (Collected / Unavailable / Error), record count, source endpoint (or `projection:<name>`), and the reason or `as of` time.
- Rules that need an uncollected dataset are listed as skipped, never as passed.
- Optional sources (B4, `sources.console.enabled` / `sources.claudeCode.enabled`, default off): while off, their five datasets (`consoleWorkspaces`, `consoleApiKeys`, `consoleUsage`, `consoleCost`, `claudeCodeActivity`) have no row, so existing tenants see the same 13 rows. When enabled they appear like any other dataset (a missing key or 401 / 403 / 404 is `unavailable` with the reason, schema drift is `error`) and in `#/config` Data sources. Publication is aggregate-only: no per-person Claude Code row is written to `dashboard.json` or the detail files.

### F-016 Adoption

- Daily, weekly and monthly active users as three lines with a legend (the weekly and monthly series converge, so values are read from the tooltip and table rather than end labels).
- Subtitle: assigned seats, pending invites and monthly adoption rate from the latest summary.

### F-012 Organization / group drill-down (B2-10)

- Routes `#/orgs` (index, "Organizations" in the nav), `#/orgs/<id>` and `#/groups/<id>` (deep links; sub-pages keep "Organizations" current). Source: `detail/org-groups.json`; the organization page also reads `detail/members.json` and the manifest (`maskPii` note, reason a dataset is unavailable).
- Index: linked organizations (members, deviation count), RBAC groups (source, members, month-to-date spend; groups overlap so spend is not additive), search across both, and an "Unattributed deviations" card.
- Organization page: configuration deviations (CF-xxx) with severity and status as icon / dot + label + color, and the organization's members (joined by `organizationId`, printed as published). Group page: source, member count, month-to-date spend and its share of the highest-spending group (never summed).
- Deviations belong to an organization only when the check evidence IDs match a linked organization; otherwise `organizationId` is null and the row appears under "Unattributed".
- Contract limits: a group carries only `memberCount` (no member list, so none is shown and no join is invented), deviations are not attributed to groups, and spend exists per group only (none per organization). When no member carries an organization (as in the synthetic sample), the organization member list says so instead of showing an empty join.
- States: loading, not published, not collected (manifest reason), error (alert), empty, no match, unknown id (not found).

### F-009 Monthly cost report viewer (B2-7)

- Routes `#/reports/monthly` (newest month) and `#/reports/monthly/<id>` (`<id>` = `monthly-yyyy-mm`; deep link). Source: `detail/monthly/index.json` (month list, newest first) and one `detail/monthly/<id>.json` per month, a small mapped subset of the collector's monthly report (`MONTHLY_REPORT_SCHEMA_VERSION = 1`), not the report document itself. The month selector is built from the index.
- Per month: the organization total (the ungrouped value), the chargeback table per RBAC group (cost and share of the total), cost by model and by product, period, generation time and the report notes. Search filters all three tables.
- **Overlap notice (CHANGE-PLAN section 10 V7):** a member counts toward every group they belong to, so group amounts can add up to more than the organization total. The notice is always shown next to the tables ("Groups overlap", icon + label) and is emphasised with an extra sentence when the group amounts exceed the total. Group amounts are never summed: there is no total row for groups.
- States: loading, not published (index or month file absent), not collected (month `unavailable`, with the reason; shown by icon + label), error (alert), empty (no month in the index), no match (search), unknown month id. Monthly files carry no per-person data, so `maskPii` does not change the page.
- Publication: the files live under `detail/` and follow the detail rule (cost per group is confidential): on Pages only with `PAGES_DATA_SOURCE=live` and `PAGES_DETAIL_DATA=true` (Private Pages), always in the synthetic sample. `pnpm report:monthly` writes them next to the Markdown / HTML / CSV / JSON report (which are unchanged); `pnpm demo` generates three synthetic months with overlapping groups. No export and no chart in this unit (tables are the primary view).

### F-010 Model x group heatmap and model mix trend (B2-8)

- Route `#/models` ("Models" in the nav), reading `detail/usage-matrix.json` (`USAGE_MATRIX_SCHEMA_VERSION = 1`, listed in the manifest as `kind: usage-matrix`; the manifest count is the number of month x model x group cells). Read-only.
- **Heatmap:** models (rows) x RBAC groups (columns) as spend per cell, with a period selector (all months or one month) and a search box (a query that matches only group names keeps every model and the other way round). The fill is a single-hue sequential continuous scale (blue, linear from zero to the largest shown cell) with a legend (low, middle, high values). Every cell prints its value, so the value never depends on color; a cell with no reported spend shows "–". Hover or keyboard focus fills a readout line with the exact value and the cell's share of the model's ungrouped spend; cells also carry the same text as tooltip and accessible name. One tab stop, arrow keys move between cells. The grid scrolls inside its own container (no horizontal page scroll at 390 px). Light and dark use separate validated endpoints (`--seq-lo` / `--seq-hi`); the value text sits on a surface-colored chip, so its contrast does not depend on the fill.
- **Model mix trend:** one 100 % bar per month with the share of the ungrouped monthly spend per model (the three largest models in categorical slots 1 to 3 in fixed order, everything else "Other models"). No animation.
- **View as table:** one button switches both charts to tables with the same numbers (cells sorted by spend with share, the ungrouped model totals, and model x month shares) and back.
- **Overlap note (CHANGE-PLAN section 10 V7):** a member counts toward every group they belong to, so the group cells of one model can add up to more than that model's spend. The note "Groups overlap" is always shown; the heatmap has no row or column totals; model totals and the monthly mix are the ungrouped values (`group_by[]=model` only), never sums of cells.
- States: loading, not published (file and manifest entry absent; the page adds how to enable the collection), not collected (manifest `unavailable` with its reason, e.g. the API rejected the request), error (alert), empty (no spend reported), no match (search).
- Caps: at most 12 models and 30 groups are kept (highest spend first); the rest are counted and the page says how many are not shown.
- **Data source and its limits (spike result, D6):** pairwise model x group data needs `group_by[]=model&group_by[]=rbac_group_id` on the Analytics `cost_report`. The repo's references confirm that `group_by[]` is an array parameter (Admin Usage / Cost API reference); that the **Enterprise Analytics** endpoint accepts two values at once is **assumed, not confirmed** (no captured response exists yet). Therefore the collection is opt-in (`sources.usageMatrix.enabled`, default `false`; `lookbackDays`, default 90) and is not a snapshot dataset, so the 13 datasets, coverage, OP-002 and the score are unchanged either way. `pnpm pipeline` runs a `usage-matrix` step after `collect` (also `pnpm usage-matrix`); a rejected request (HTTP 400 / 401 / 403 / 404 / 422) is stored as `unavailable` and anything else as `error`, both with a short reason, and the pipeline continues. Cost is the only measure (no token matrix). Verifying the pairwise response on a real tenant is a human task (capture with `--capture-raw`, sanitize into the fixture tenant).
- Publication: under `detail/`, so the detail rule applies (cost per group is confidential, group names show the organization structure): on Pages only with `PAGES_DATA_SOURCE=live` and `PAGES_DETAIL_DATA=true`; always in the synthetic sample. `pnpm demo` generates three synthetic months (2026-06 to 2026-08) with a dominant model whose share falls, a zero cell, a "No group" column and overlapping groups; only `detail/index.json` of the other sample files changes (one manifest entry).

### F-014 Effective configuration view (B2-12)

- Route `#/config`, reading `detail/config.json` (`CONFIG_VIEW_SCHEMA_VERSION = 1`, listed in the manifest as `kind: config`; the manifest entry carries the file's own version). Read-only: nothing on the page changes the configuration.
- Sections: **Compliance rules** (every rule with Enabled / Disabled, category, severity, datasets it needs, and Custom / "replaces built-in" origin; filter chips All / Enabled / Disabled / Custom with counts), **Rule parameters** (effective value next to the rule default, Overridden / Default, Invalid when the configured values are rejected by the rule), **Custom rules** (setting baselines and activity watches from `config/custom-rules.json`), **Notification policy** (statuses, minimum severity, cooldown, channels by kind), **Data sources** (every dataset Enabled / Disabled plus the collection settings) and **Other settings** (snapshot retention, `maskPii`). Enabled / disabled and overridden / default are icon + label + color. One search box filters all sections.
- **Safety:** the file is built from an explicit allowlist (`buildConfigView()`, core, pure), never from a dump of the loaded config. It has no field that can hold an API key, webhook URL, SMTP host or credential, or recipient address: channels are `console` / `slack` / `discord` / `email` with an `enabled` flag only. Rule names, custom rule settings and parameter values additionally pass a redaction guard (`looksSensitive`: URLs, `@`, key and token shapes, absolute paths, opaque long tokens become `[hidden]`), parameters not declared by the rule are dropped, and configured ids that match no rule are shown only when they have the rule-id format. `checkDetailBundle()` (and so `pnpm fork:verify`) rejects any such string in the file.
- States: loading, not published (file absent), not collected (manifest `unavailable` with its reason), error (alert), empty (no entries), no match (search).
- Publication: under `detail/`, so the detail rule applies: on Pages only with `PAGES_DATA_SOURCE=live` and `PAGES_DETAIL_DATA=true`; always in the synthetic sample. Written by `pnpm build:detail` / `pnpm pipeline`; it does not depend on collected data, so it is present even when every dataset is unavailable. The sample's configuration (a disabled rule, an overridden parameter, two custom rules, a notification policy with Slack and e-mail on) is **illustrative**: `pnpm demo` fixes it independently of the local config and does not apply it to the sample compliance results, so the other sample files are unchanged.

### F-013 Archive inventory (B2-11)

- Route `#/archive` ("Archive" in the nav), reading `detail/archive.json` (`ARCHIVE_VIEW_SCHEMA_VERSION = 1`, listed in the manifest as `kind: archive`; the manifest count is the number of archived snapshots). Read-only.
- Content: totals (archived snapshots, compressed size, years covered, oldest and newest snapshot, the retention setting `retention.snapshotDays` after which snapshots are archived) and one row per year (newest year first): snapshot count, compressed size, share of the total size, oldest and newest snapshot. Sizes are binary (1 KB = 1,024 bytes) and shown up to PB. A status badge (icon + label + color) says Archived, No archives yet, or Unrecognized files (some entries of the archive directory are not `<snapshot id>.json.gz`; they are only counted, never named). A search box filters years by year or snapshot date.
- **What the file can hold:** snapshot ids (validated shape `yyyy-mm-ddThh-mm-ssZ`), years, counts and byte sizes. No file name, path or snapshot content can be represented, so there is no PII, secret or absolute path; `checkDetailBundle()` (and so `pnpm fork:verify`) also checks that the totals equal the per-year rows.
- Aggregation: `summarizeArchiveEntries()` (core, pure, order-independent; a repeated id counts once) turns listed entries (year directory, file name, compressed bytes) into the inventory; the collector lists `archive/<year>/*` and stats the sizes behind the small `ArchiveListing` port (`adapters/storage/archive-inventory.ts`, `summarizeArchive(store)`). Phase B3 (#38) reuses it for the capacity measurement. This unit is tested with the synthetic sample and temporary directories only; verification against a real archive is B3.
- States: loading, not published (file absent), not collected (manifest `unavailable` with its reason, e.g. the archive could not be listed), error (alert), empty (no archives yet), no match (search).
- Publication: under `detail/`, so the detail rule applies: on Pages only with `PAGES_DATA_SOURCE=live` and `PAGES_DETAIL_DATA=true`; always in the synthetic sample. Written by `pnpm build:detail` / `pnpm pipeline` (the inventory reflects the archive at that time; the scheduled workflow archives before it writes the detail files). `pnpm demo` supplies a synthetic archive (84 snapshots over 2023 to 2025 with deterministic sizes and one unrelated file) without touching the other sample files.

### F-008 Alert history (B2-6)

- Route `#/alerts` ("Alerts" in the nav), reading `detail/alerts.json` (`ALERTS_VIEW_SCHEMA_VERSION = 1`, listed in the manifest as `kind: alerts`; the manifest count is the number of listed alerts, newest first, at most 200). **Read-only**: a static SPA cannot write, so the page only displays the acknowledgement state and explains how to acknowledge.
- Content: totals (alerts sent, acknowledged, unacknowledged) and one row per alert: sent time, severity, rule ids and the channel kinds that delivered it (console, Slack, Discord, e-mail), the alert title with its id, and the acknowledgement status as icon + label + color (Acknowledged with the acknowledger label and time, or Unacknowledged). Search (id, title, severity, kind, channel, rule id, acknowledger, time) and an acknowledgement filter (All / Acknowledged / Unacknowledged, with counts).
- **How to acknowledge** (shown on the page): `pnpm alerts ack <alert-id> [--by <label>]`, or run the **Acknowledge Alert** workflow (`.github/workflows/ack-alert.yml`, `workflow_dispatch` with `alert-id` and an optional `by-label`). Decision D3: who may acknowledge is "anyone with write access to the repository" (they can run the workflow / push to `data/audit`). The acknowledgement is stored as `alerts/ack.json` on the `data/audit` branch (`ACK_STORE_SCHEMA_VERSION = 1`; separate from `state.json`, whose `parseState()` resets unknown shapes) and the status appears once `detail/alerts.json` is rebuilt (the workflow does it; the scheduled collection does it after each notify).
- Data sources: the send records are `state.json` `notifications.history` (appended by `notify` and `report --notify`: key, time, severity, delivering channel ids, title; optional additive field, no `STATE_SCHEMA_VERSION` change, older states keep working) plus older `lastSent` entries that have no record (shown with severity "unknown" and channel "Not recorded"). The alert id is `al_` + a stable hash of the key and the send time. `buildAlertsView()` (core, pure) joins sends and acknowledgements: the first acknowledgement of an alert wins, acknowledgements of unknown alerts are dropped, output is deterministic.
- **What the file can hold:** ids, times, severities, channel kinds, rule ids with their status, a title and an acknowledger label. No webhook URL, recipient, SMTP setting, secret, path or finding message can be represented. The title and the free-text label go through the same allowlist approach as the configuration view (`looksSensitive`): an e-mail address, URL, token or path becomes `[hidden]`; labels are at most 40 characters. `checkDetailBundle()` (and so `pnpm fork:verify`) checks the contract, the totals, the acknowledgement fields, duplicate ids and string leaks.
- Collector: `alerts ack` refuses an unknown or malformed alert id, keeps the first of a duplicate acknowledgement (exit 0), and never overwrites an unreadable `alerts/ack.json`.
- States: loading, not published (file absent), not collected (manifest `unavailable` with its reason), error (alert), empty ("No alerts sent yet"), no match (search / filter).
- Publication: under `detail/`, so the detail rule applies: on Pages only with `PAGES_DATA_SOURCE=live` and `PAGES_DETAIL_DATA=true`; always in the synthetic sample. `alerts/ack.json` itself is never staged. `pnpm demo` supplies six synthetic alerts across the four channels and severities (three acknowledged by fictional team labels). The fixture tenant has no alert history, so it renders "No alerts sent yet".

### F-017 Insights

- Title and detail of each analyzer result (model concentration, cache efficiency, group concentration, seat utilization) with its priority.

### F-006 Member view (B2-4)

- Route `#/members`, reading `detail/members.json` (and the manifest for the `maskPii` note and the reason a dataset is unavailable).
- Table of member (name, e-mail), role, last activity date and status. Status is icon + label + color: Active, Inactive (AC-001) and Unknown (activity not collected, never shown as inactive). Inactive rows are also tinted. The inactivity threshold shown is the file's `inactiveDays` (the effective AC-001 value), not a constant.
- Search (name, e-mail, role), role filter, status filter with counts, sort by name / role / last active / status (inactive first by default). Pending invites are listed in their own table.
- States: loading, not published (file absent), not collected (manifest `unavailable` with its reason), error (alert), no members, no match for the filters.
- Group membership is not part of the `detail-members` contract (only `organizationId`), so it is not shown; the group drill-down (F-012) carries member counts per group.

### F-007 API key inventory (B2-5)

- Route `#/keys`, reading `detail/api-keys.json` (and the manifest for the `maskPii` note and the reason a dataset is unavailable).
- Table of key (name and ID as published, masked while `maskPii` is on), scopes, age in days, expiry, last-used time and a rotation recommendation. The recommendation is icon + label + color plus the reason text: Rotate (older than `maxAgeDays`, AK-003, or expired), Unused (no API call within `unusedDays`, AK-001; a never-seen key counts only once usage has been observed for `unusedDays`), Write scope (`write:*` / `delete:*`, AK-002), Rotate soon (from 80% of `maxAgeDays`; a display hint, not a rule), Use unknown (observation window too short), OK, and Deactivated (no action). Thresholds and the evaluation time (`generatedAt`) come from the file, not from constants or the browser clock.
- AK-001 is judged only for keys with Compliance API scopes, as in the rule. The AK-002 flagged-scope list is not in the file, so the built-in default (write / delete scopes) is used; a tenant that overrides `flaggedScopes` can differ.
- Search (name, ID, scope), recommendation filter with counts, sort by name / age / last used / recommendation (most urgent first by default).
- States: loading, not published (file absent), not collected (manifest `unavailable` with its reason), error (alert), no keys, no match for the filters. Key secrets are never collected or shown.

---

## Detail data files (B2-2)

The screens of F-005 (search), F-006, F-007, F-008, F-009, F-010 (model x group), F-012, F-013 (archive) and F-014 read a manifest plus one file per entity. `DashboardView` stays v2 and aggregate-only; each file carries its own `schemaVersion` (`DETAIL_SCHEMA_VERSION = 1`, zod schemas in `@claude-audit/core/contracts`).

| File                             | Content                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `detail/index.json`              | Manifest: `maskPii`, `source`, and per file `kind`, `path`, `status` (`ok` / `unavailable` + reason), `count`                                                 |
| `detail/members.json`            | Members (role, organization, `active`, `lastActiveOn`), invites, the AC-001 `inactiveDays` threshold                                                          |
| `detail/api-keys.json`           | Keys (scopes, active, created / expires, creator, `lastSeenAt`), AK-001 / AK-003 thresholds, usage window start                                               |
| `detail/activity-<yyyy-mm>.json` | One file per UTC month, newest first, capped at 2000 rows (`total` and `truncated` give the real count)                                                       |
| `detail/org-groups.json`         | Organizations, RBAC groups (member count, month-to-date spend; groups overlap), CF-xxx deviations                                                             |
| `detail/config.json`             | Effective configuration (allowlisted): rules with state / origin / effective parameters, custom rules, notification policy, sources                           |
| `detail/archive.json`            | Archive inventory: per-year snapshot count, compressed bytes, oldest / newest snapshot id, totals, retention setting (ids, years, counts, bytes only)         |
| `detail/alerts.json`             | Alert history: sent alerts (time, severity, channel kinds, rule ids, redacted title) joined with their acknowledgement (time, masked label)                   |
| `detail/usage-matrix.json`       | Model x RBAC group cost per month (cells overlap across groups), ungrouped model mix per month, model totals; present only when `sources.usageMatrix.enabled` |
| `detail/monthly/index.json`      | Monthly cost reports: month list (newest first), status, organization total (no per-person data; written by `report monthly`)                                 |
| `detail/monthly/<id>.json`       | One month: organization total, cost by RBAC group / model / product (amount, share), notes; group rows overlap                                                |

Identifier handling follows `dashboard.maskPii` (default `true`): e-mail addresses become `j***@example.com`, names become initials (`A*** E***`), IP addresses are dropped, and user / key / invite IDs become `u_` / `k_` / `i_` plus 12 hex characters, stable across files so rows stay joinable. With `maskPii=false` raw values are written (and the manifest says so). A missing file with an `unavailable` manifest entry means the dataset was not collected; absence of the whole directory means "not published". `pnpm build:detail` (part of `pnpm pipeline`) writes `data/detail/`; `pnpm demo` writes the synthetic `data/sample/detail/`, validated by `pnpm fork:verify` (contract, `example.*` e-mails only, masked identifiers).

---

## Planned (Phase B and later)

| ID    | Scope                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------ |
| F-015 | Compare two snapshots or two reports: rules that changed status, datasets that changed coverage. |

---

## Non-functional requirements

| Area          | Requirement                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Compatibility | The UI rejects `dashboard.json` with another `schemaVersion` and explains how to regenerate it |
| Performance   | One JSON file (aggregates); no runtime API calls; code-split React bundle                      |
| Accessibility | Table view for every chart; status never color-only; keyboard-operable filters and details     |
| Privacy       | E-mail addresses masked by default (`dashboard.maskPii`); sample data uses `example.com` only  |
| Testing       | Unit tests for view helpers and data loading; E2E (Playwright) in Phase B                      |
