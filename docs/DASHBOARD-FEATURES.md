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

| ID    | Feature                         | Priority | Status                                                    | Contract fields                                  |
| ----- | ------------------------------- | -------- | --------------------------------------------------------- | ------------------------------------------------ |
| F-001 | Organization overview           | P0       | ✅ Phase A                                                | `title`, `organizations`, `collectedAt`, `kpis`  |
| F-002 | Compliance score and trend      | P0       | ✅ Phase A                                                | `kpis[score]`, `compliance.history`              |
| F-003 | Compliance results              | P0       | ✅ Phase A + CSV / JSON export (B2-1)                     | `compliance.results`, `compliance.byCategory`    |
| F-004 | Usage and cost                  | P0       | ✅ Phase A                                                | `usage.daily`, `usage.byProduct/byModel/byGroup` |
| F-005 | Activity                        | P0       | ✅ Phase A aggregates; B2 (B2-3, `#/activity`) search     | `activity`                                       |
| F-006 | Member view                     | P1       | ✅ Phase B2 (B2-4, `#/members`)                           | detail `members.json` (B2-2)                     |
| F-007 | API key inventory               | P1       | ✅ Phase B2 (B2-5, `#/keys`)                              | detail `api-keys.json` (B2-2)                    |
| F-008 | Alert history                   | P1       | ⏳ Phase B                                                | notification state                               |
| F-009 | Monthly cost report view        | P1       | 🔶 Files in Phase A; viewer in Phase B                    | `data/reports/monthly/*`                         |
| F-010 | Model usage analytics           | P1       | 🔶 Phase A (spend by model, insights); heatmap in Phase B | `usage.byModel`, `insights`                      |
| F-011 | Light / dark theme              | P2       | ✅ Phase A (follows system); toggle UI in Phase B2 (B2-9) | —                                                |
| F-012 | Organization / group drill-down | P2       | ✅ B2-10 (`#/orgs`, `#/orgs/<id>`, `#/groups/<id>`)       | detail `org-groups.json`, `members.json`         |
| F-013 | Data coverage and retention     | P2       | ✅ coverage in Phase A; archive inventory in Phase B      | `coverage`                                       |
| F-014 | Configuration view (read-only)  | P2       | ⏳ Phase B                                                | —                                                |
| F-015 | Snapshot comparison             | P3       | ⏳ Later                                                  | —                                                |
| F-016 | Adoption (DAU / WAU / MAU)      | P1       | ✅ Phase A                                                | `adoption`                                       |
| F-017 | Insights                        | P1       | ✅ Phase A                                                | `insights`                                       |

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

The screens of F-005 (search), F-006, F-007 and F-012 read a manifest plus one file per entity. `DashboardView` stays v2 and aggregate-only; each file carries its own `schemaVersion` (`DETAIL_SCHEMA_VERSION = 1`, zod schemas in `@claude-audit/core/contracts`).

| File                             | Content                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `detail/index.json`              | Manifest: `maskPii`, `source`, and per file `kind`, `path`, `status` (`ok` / `unavailable` + reason), `count`   |
| `detail/members.json`            | Members (role, organization, `active`, `lastActiveOn`), invites, the AC-001 `inactiveDays` threshold            |
| `detail/api-keys.json`           | Keys (scopes, active, created / expires, creator, `lastSeenAt`), AK-001 / AK-003 thresholds, usage window start |
| `detail/activity-<yyyy-mm>.json` | One file per UTC month, newest first, capped at 2000 rows (`total` and `truncated` give the real count)         |
| `detail/org-groups.json`         | Organizations, RBAC groups (member count, month-to-date spend; groups overlap), CF-xxx deviations               |

Identifier handling follows `dashboard.maskPii` (default `true`): e-mail addresses become `j***@example.com`, names become initials (`A*** E***`), IP addresses are dropped, and user / key / invite IDs become `u_` / `k_` / `i_` plus 12 hex characters, stable across files so rows stay joinable. With `maskPii=false` raw values are written (and the manifest says so). A missing file with an `unavailable` manifest entry means the dataset was not collected; absence of the whole directory means "not published". `pnpm build:detail` (part of `pnpm pipeline`) writes `data/detail/`; `pnpm demo` writes the synthetic `data/sample/detail/`, validated by `pnpm fork:verify` (contract, `example.*` e-mails only, masked identifiers).

---

## Planned (Phase B and later)

| ID    | Scope                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------- |
| F-008 | History of alerts sent (from the notification state) and their acknowledgement status.                        |
| F-009 | In-app viewer for `data/reports/monthly/*` with charge-back tables per RBAC group.                            |
| F-010 | Model × group heatmap (sequential single-hue scale with a legend), trend of model mix.                        |
| F-012 | Drill-down per linked organization or RBAC group: members, settings deviations (CF-xxx), spend.               |
| F-013 | Archive inventory (years, snapshot counts, sizes).                                                            |
| F-014 | Read-only view of the effective configuration: disabled rules, parameters, custom rules, notification policy. |
| F-015 | Compare two snapshots or two reports: rules that changed status, datasets that changed coverage.              |

---

## Non-functional requirements

| Area          | Requirement                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Compatibility | The UI rejects `dashboard.json` with another `schemaVersion` and explains how to regenerate it |
| Performance   | One JSON file (aggregates); no runtime API calls; code-split React bundle                      |
| Accessibility | Table view for every chart; status never color-only; keyboard-operable filters and details     |
| Privacy       | E-mail addresses masked by default (`dashboard.maskPii`); sample data uses `example.com` only  |
| Testing       | Unit tests for view helpers and data loading; E2E (Playwright) in Phase B                      |
